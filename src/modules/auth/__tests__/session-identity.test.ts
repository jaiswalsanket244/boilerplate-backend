import { createApp } from "@/app";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";
import { RefreshToken } from "@/db/models/refreshToken";
import { jwtHelper } from "@/helpers/jwt";
import { authHelper } from "@/modules/auth/helpers/auth.helper";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

function buildPasswordLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: "unused@example.com",
    password: "StrongPass@123",
    loginType: "password",
    ...overrides,
  };
}

describe("durable session identity", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (b) a fresh login persists sessionId + userAgent + ip
  it("persists sessionId, userAgent and ip on a fresh password login", async () => {
    const { user } = await createTestSession();
    mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
      user: { id: user.externalUserId, email: user.email },
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send(buildPasswordLoginPayload({ email: user.email }))
      .set("Accept", "application/json")
      .set("User-Agent", "vitest-agent/1.0")
      .set("x-client-platform", "mobile");

    expect(res.status).toBe(200);
    const { token } = res.body.data;

    const record = await RefreshToken.findOne({ userId: user._id });
    expect(record).not.toBeNull();
    expect(typeof record!.sessionId).toBe("string");
    expect(record!.sessionId!.length).toBeGreaterThan(0);
    expect(record!.userAgent).toBe("vitest-agent/1.0");
    expect(typeof record!.ip).toBe("string");
    expect(record!.ip!.length).toBeGreaterThan(0);
    expect(record!.lastActiveAt).toBeInstanceOf(Date);

    // The access-token claim must match the persisted session identity so
    // mobile clients (no refresh cookie on GETs) can identify their session.
    const claims = jwtHelper.verifyToken(token);
    expect(claims.sessionId).toBe(record!.sessionId);
  });

  // (a) sessionId is stable across at least two consecutive refreshSession calls
  it("keeps sessionId stable across consecutive refreshes and preserves createdAt", async () => {
    const { user } = await createTestSession();

    const { token, refreshToken, sessionId } = await generateAuthTokens(
      { user },
      undefined,
      { userAgent: "seed-agent", ip: "10.0.0.1" },
    );
    expect(jwtHelper.verifyToken(token).sessionId).toBe(sessionId);

    const original = await RefreshToken.findOne({ sessionId });
    const originalCreatedAt = original!.createdAt;

    const first = await authHelper.refreshSession(refreshToken);
    if (first.error !== null) throw new Error(first.error);
    expect(jwtHelper.verifyToken(first.token!).sessionId).toBe(sessionId);

    const second = await authHelper.refreshSession(first.refreshToken!);
    if (second.error !== null) throw new Error(second.error);
    expect(jwtHelper.verifyToken(second.token!).sessionId).toBe(sessionId);

    // Rotation must not churn the row: still one row, same identity, original
    // createdAt preserved, device metadata carried over, lastActiveAt bumped.
    const rows = await RefreshToken.find({ userId: user._id });
    expect(rows).toHaveLength(1);
    const rotated = rows[0];
    expect(rotated.sessionId).toBe(sessionId);
    expect(rotated.createdAt.getTime()).toBe(originalCreatedAt.getTime());
    expect(rotated.userAgent).toBe("seed-agent");
    expect(rotated.ip).toBe("10.0.0.1");
    expect(rotated.lastActiveAt!.getTime()).toBeGreaterThanOrEqual(
      originalCreatedAt.getTime(),
    );
    // Old refresh tokens are consumed by the in-place rotation.
    expect(await RefreshToken.findOne({ token: refreshToken })).toBeNull();
    expect(
      await RefreshToken.findOne({ token: first.refreshToken }),
    ).toBeNull();
    expect(rotated.token).toBe(second.refreshToken);
  });

  // (c) a legacy row (no sessionId) refreshes successfully and gains one
  it("lazily assigns a sessionId to a legacy row on refresh", async () => {
    const { user } = await createTestSession();

    const legacyToken = "legacy-refresh-token-value";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Insert via the native driver to bypass schema validation — this mirrors a
    // row written before sessionId existed on the collection.
    const inserted = await RefreshToken.collection.insertOne({
      userId: user._id,
      token: legacyToken,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    const result = await authHelper.refreshSession(legacyToken);
    expect(result.error).toBeNull();
    expect(typeof result.refreshToken).toBe("string");

    const rows = await RefreshToken.find({ userId: user._id });
    expect(rows).toHaveLength(1);
    expect(rows[0]._id.toString()).toBe(inserted.insertedId.toString());
    expect(typeof rows[0].sessionId).toBe("string");
    expect(rows[0].sessionId!.length).toBeGreaterThan(0);
    expect(jwtHelper.verifyToken(result.token!).sessionId).toBe(
      rows[0].sessionId,
    );
  });
});
