import { createApp } from "@/app";
import { RefreshToken } from "@/db/models/refreshToken";
import { authHelper } from "@/modules/auth/helpers/auth.helper";
import { createTestSession } from "@/tests/utils/auth";
import mongoose from "mongoose";
import crypto from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller fans a "password changed" notification out over Socket.IO,
// which is not initialized under the test harness. Stub the helper so the test
// stays scoped to the session-invalidation behavior.
vi.mock("@/modules/notifications/helpers/notifications.helper", () => ({
  notificationsHelper: {
    getPreferences: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
  },
}));

/**
 * POST /api/user/change-password (authenticated)
 *
 * Policy: signing out every OTHER session while keeping the device the password
 * was changed from signed in via its freshly issued tokens.
 */

async function seedSession(userId: mongoose.Types.ObjectId | string) {
  const token = crypto.randomBytes(20).toString("hex");
  await RefreshToken.create({
    userId,
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    sessionId: crypto.randomUUID(),
    userAgent: "unknown",
    ip: "unknown",
    lastActiveAt: new Date(),
  });
  return token;
}

function changePasswordPayload() {
  return {
    currentPassword: "OldPass@123",
    newPassword: "NewPass@123",
    confirmedPassword: "NewPass@123",
  };
}

describe("POST /api/user/change-password — session invalidation", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the current device signed in and revokes every other session", async () => {
    const session = await createTestSession();

    // Pre-change row on this device plus two other devices.
    await seedSession(session.user._id);
    const otherTokens = [
      await seedSession(session.user._id),
      await seedSession(session.user._id),
    ];

    const res = await request(app)
      .post("/api/user/change-password")
      .set("x-client-platform", "mobile")
      .set("Authorization", session.bearerHeader)
      .send(changePasswordPayload());

    expect(res.status).toBe(200);

    const newRefreshToken = res.body.data.refreshToken as string;
    expect(newRefreshToken).toBeTruthy();

    // Exactly one session survives — the freshly minted current one.
    const remaining = await RefreshToken.find({ userId: session.user._id });
    expect(remaining).toHaveLength(1);
    expect((await authHelper.refreshSession(newRefreshToken)).error).toBeNull();

    for (const token of otherTokens) {
      expect((await authHelper.refreshSession(token)).error).not.toBeNull();
    }
  });

  it("does not touch another user's sessions", async () => {
    const session = await createTestSession();
    const other = await createTestSession();
    const otherToken = await seedSession(other.user._id);

    const res = await request(app)
      .post("/api/user/change-password")
      .set("x-client-platform", "mobile")
      .set("Authorization", session.bearerHeader)
      .send(changePasswordPayload());

    expect(res.status).toBe(200);
    expect(await RefreshToken.find({ userId: other.user._id })).toHaveLength(1);
    expect((await authHelper.refreshSession(otherToken)).error).toBeNull();
  });
});
