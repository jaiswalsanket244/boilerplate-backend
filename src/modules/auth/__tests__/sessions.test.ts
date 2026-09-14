import { createApp } from "@/app";
import { RefreshToken } from "@/db/models/refreshToken";
import { authHelper } from "@/modules/auth/helpers/auth.helper";
import { createTestSession } from "@/tests/utils/auth";
import mongoose from "mongoose";
import crypto from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session management APIs
 *
 *   GET    /api/auth/sessions
 *   DELETE /api/auth/sessions/:sessionId
 *   POST   /api/auth/sessions/revoke-others
 *
 * Auth required : Yes (jwtDecoder + authMiddleware) — 401 otherwise.
 */

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

interface SeedOverrides {
  sessionId?: string;
  token?: string;
  userAgent?: string;
  ip?: string;
  lastActiveAt?: Date;
}

async function seedSession(
  userId: mongoose.Types.ObjectId | string,
  overrides: SeedOverrides = {},
) {
  return RefreshToken.create({
    userId,
    token: overrides.token ?? crypto.randomBytes(20).toString("hex"),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    userAgent: overrides.userAgent ?? "unknown",
    ip: overrides.ip ?? "unknown",
    lastActiveAt: overrides.lastActiveAt ?? new Date(),
  });
}

describe("Session management APIs", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET /api/auth/sessions
  // =========================================================================

  describe("GET /api/auth/sessions", () => {
    it("lists only the caller's sessions with a correct isCurrent flag and parsed metadata, never leaking token values", async () => {
      const session = await createTestSession();

      await seedSession(session.user._id, {
        sessionId: session.sessionId,
        userAgent: CHROME_WIN,
        ip: "203.0.113.10",
        lastActiveAt: new Date(Date.now() - 60_000),
      });
      await seedSession(session.user._id, {
        userAgent: SAFARI_IOS,
        ip: "203.0.113.20",
        lastActiveAt: new Date(),
      });

      // A different user's session must never appear.
      const other = await createTestSession();
      await seedSession(other.user._id);

      const res = await request(app)
        .get("/api/auth/sessions")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      const { sessions } = res.body.data;
      expect(sessions).toHaveLength(2);

      // Most-recently-active first.
      expect(sessions[0].lastActiveAt >= sessions[1].lastActiveAt).toBe(true);

      const current = sessions.find(
        (s: { id: string }) => s.id === session.sessionId,
      );
      const nonCurrent = sessions.find(
        (s: { id: string }) => s.id !== session.sessionId,
      );

      expect(current.isCurrent).toBe(true);
      expect(current.browser).toBe("Chrome");
      expect(current.os).toBe("Windows");
      expect(current.device).toBe("Desktop");
      expect(current.ipDisplay).toBe("203.0.113.10");

      expect(nonCurrent.isCurrent).toBe(false);
      expect(nonCurrent.browser).toBe("Safari");
      expect(nonCurrent.os).toBe("iOS");
      expect(nonCurrent.device).toBe("Mobile");

      for (const s of sessions) {
        expect(s).not.toHaveProperty("token");
        expect(s).not.toHaveProperty("userId");
      }
    });

    it("works for a mobile (Bearer) caller", async () => {
      const session = await createTestSession();
      await seedSession(session.user._id, { sessionId: session.sessionId });

      const res = await request(app)
        .get("/api/auth/sessions")
        .set("x-client-platform", "mobile")
        .set("Authorization", session.bearerHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.sessions).toHaveLength(1);
      expect(res.body.data.sessions[0].isCurrent).toBe(true);
    });

    it("returns 401 for an unauthenticated request", async () => {
      const res = await request(app).get("/api/auth/sessions");
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // DELETE /api/auth/sessions/:sessionId
  // =========================================================================

  describe("DELETE /api/auth/sessions/:sessionId", () => {
    it("revokes a non-current owned session so it can no longer refresh nor appear in the list", async () => {
      const session = await createTestSession();
      await seedSession(session.user._id, { sessionId: session.sessionId });

      const targetToken = crypto.randomBytes(20).toString("hex");
      const target = await seedSession(session.user._id, {
        token: targetToken,
      });

      const res = await request(app)
        .delete(`/api/auth/sessions/${target.sessionId}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);

      expect(
        await RefreshToken.findOne({ sessionId: target.sessionId }),
      ).toBeNull();

      const refreshAttempt = await authHelper.refreshSession(targetToken);
      expect(refreshAttempt.error).not.toBeNull();

      const list = await request(app)
        .get("/api/auth/sessions")
        .set("Cookie", session.cookie);
      expect(
        list.body.data.sessions.some(
          (s: { id: string }) => s.id === target.sessionId,
        ),
      ).toBe(false);
    });

    it("returns 404 when the sessionId does not belong to the caller", async () => {
      const session = await createTestSession();
      await seedSession(session.user._id, { sessionId: session.sessionId });

      const other = await createTestSession();
      const otherSession = await seedSession(other.user._id);

      const res = await request(app)
        .delete(`/api/auth/sessions/${otherSession.sessionId}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(404);
      // The other user's session must survive the cross-user attempt.
      expect(
        await RefreshToken.findOne({ sessionId: otherSession.sessionId }),
      ).not.toBeNull();
    });

    it("returns 400 when targeting the caller's current session", async () => {
      const session = await createTestSession();
      await seedSession(session.user._id, { sessionId: session.sessionId });

      const res = await request(app)
        .delete(`/api/auth/sessions/${session.sessionId}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(400);
      expect(
        await RefreshToken.findOne({ sessionId: session.sessionId }),
      ).not.toBeNull();
    });

    it("returns 401 for an unauthenticated request", async () => {
      const res = await request(app).delete(
        `/api/auth/sessions/${crypto.randomUUID()}`,
      );
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/auth/sessions/revoke-others
  // =========================================================================

  describe("POST /api/auth/sessions/revoke-others", () => {
    it("removes all sessions except the current one and returns an accurate count", async () => {
      const session = await createTestSession();
      const currentToken = crypto.randomBytes(20).toString("hex");
      await seedSession(session.user._id, {
        sessionId: session.sessionId,
        token: currentToken,
      });
      await seedSession(session.user._id);
      await seedSession(session.user._id);

      // A different user's sessions must be untouched.
      const other = await createTestSession();
      await seedSession(other.user._id);

      const res = await request(app)
        .post("/api/auth/sessions/revoke-others")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.revokedCount).toBe(2);

      const remaining = await RefreshToken.find({ userId: session.user._id });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sessionId).toBe(session.sessionId);

      // Current session still works.
      const refreshAttempt = await authHelper.refreshSession(currentToken);
      expect(refreshAttempt.error).toBeNull();

      // The other user is unaffected.
      expect(await RefreshToken.find({ userId: other.user._id })).toHaveLength(
        1,
      );
    });

    it("returns 401 for an unauthenticated request", async () => {
      const res = await request(app).post("/api/auth/sessions/revoke-others");
      expect(res.status).toBe(401);
    });
  });
});
