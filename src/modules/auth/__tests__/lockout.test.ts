import { createApp } from "@/app";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import envConfig from "@/config/env";
import { ERROR_CODES } from "@/constants/error-codes";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { LoginAttempt } from "@/db/models/loginAttempt";
import {
  clearFailedAttempts,
  evaluateLockState,
  recordFailedAttempt,
} from "@/modules/auth/helpers/lockout.helper";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

function buildPasswordLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    loginType: "password",
    ...overrides,
  };
}

async function seedAttempt(email: string, failedCount: number) {
  return LoginAttempt.create({
    email,
    failedCount,
    resetRequired: false,
    lockedUntil: null,
    lastFailedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

// The kill switch is a mutable field on the shared env singleton; always restore
// it so a test that flips it off can't leak into the rest of the file.
afterEach(() => {
  envConfig.LOGIN_LOCKOUT_ENABLED = true;
});

// ---------------------------------------------------------------------------
// Helper-level threshold behaviour
// ---------------------------------------------------------------------------

describe("lockout helper — thresholds", () => {
  const email = "lockout-helper@test.dev";

  it("locks for 5 minutes at exactly 5 failures", async () => {
    for (let i = 0; i < 4; i++) {
      const state = await recordFailedAttempt(email);
      expect(state.locked).toBe(false);
    }

    const fifth = await recordFailedAttempt(email);
    expect(fifth).toEqual({ locked: true, resetRequired: false });

    const doc = await LoginAttempt.findOne({ email }).lean();
    expect(doc?.failedCount).toBe(LOGIN_LOCKOUT.THRESHOLDS.FIRST);
    const delta = (doc?.lockedUntil?.getTime() ?? 0) - Date.now();
    expect(delta).toBeGreaterThan(4 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(5 * 60 * 1000 + 2000);
  });

  it("locks for 30 minutes at exactly 10 failures", async () => {
    await seedAttempt(email, LOGIN_LOCKOUT.THRESHOLDS.SECOND - 1);

    const state = await recordFailedAttempt(email);
    expect(state).toEqual({ locked: true, resetRequired: false });

    const doc = await LoginAttempt.findOne({ email }).lean();
    expect(doc?.failedCount).toBe(LOGIN_LOCKOUT.THRESHOLDS.SECOND);
    const delta = (doc?.lockedUntil?.getTime() ?? 0) - Date.now();
    expect(delta).toBeGreaterThan(29 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(30 * 60 * 1000 + 2000);
  });

  it("terminally locks (reset required) at exactly 15 failures", async () => {
    await seedAttempt(email, LOGIN_LOCKOUT.THRESHOLDS.TERMINAL - 1);

    const state = await recordFailedAttempt(email);
    expect(state).toEqual({ locked: true, resetRequired: true });

    expect(await evaluateLockState(email)).toEqual({
      locked: true,
      resetRequired: true,
    });
  });

  it("does not lose increments under concurrent failures", async () => {
    await Promise.all(
      Array.from({ length: LOGIN_LOCKOUT.THRESHOLDS.FIRST }, () =>
        recordFailedAttempt(email),
      ),
    );

    const doc = await LoginAttempt.findOne({ email }).lean();
    expect(doc?.failedCount).toBe(LOGIN_LOCKOUT.THRESHOLDS.FIRST);
  });

  it("clears the counter and any lock", async () => {
    await LoginAttempt.create({
      email,
      failedCount: LOGIN_LOCKOUT.THRESHOLDS.TERMINAL,
      resetRequired: true,
      lastFailedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await clearFailedAttempts(email);

    expect(await LoginAttempt.findOne({ email })).toBeNull();
    expect(await evaluateLockState(email)).toEqual({
      locked: false,
      resetRequired: false,
    });
  });

  it("is a no-op when the kill switch is off", async () => {
    envConfig.LOGIN_LOCKOUT_ENABLED = false;

    for (let i = 0; i < LOGIN_LOCKOUT.THRESHOLDS.TERMINAL + 2; i++) {
      const state = await recordFailedAttempt(email);
      expect(state).toEqual({ locked: false, resetRequired: false });
    }

    expect(await LoginAttempt.findOne({ email })).toBeNull();
    expect(await evaluateLockState(email)).toEqual({
      locked: false,
      resetRequired: false,
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP-level behaviour through POST /api/auth/login
// ---------------------------------------------------------------------------

describe("POST /api/auth/login — lockout", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // A wrong password surfaces as a thrown error from the auth provider.
    mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
      new Error("Invalid email or password"),
    );
  });

  async function attemptLogin(email: string) {
    return request(app)
      .post("/api/auth/login")
      .send(buildPasswordLoginPayload({ email }))
      .set("Accept", "application/json");
  }

  it("returns 401 for the first four failures, then 429 on the fifth", async () => {
    const { user } = await createTestSession();

    for (let i = 0; i < 4; i++) {
      const res = await attemptLogin(user.email);
      expect(res.status).toBe(401);
    }

    const fifth = await attemptLogin(user.email);
    expect(fifth.status).toBe(429);
    expect(fifth.body.messageCode).toBe(ERROR_CODES.ACCOUNT_LOCKED);
  });

  it("returns 429 without calling the auth provider once locked", async () => {
    const { user } = await createTestSession();

    for (let i = 0; i < LOGIN_LOCKOUT.THRESHOLDS.FIRST; i++) {
      await attemptLogin(user.email);
    }

    mockAuthKitProvider.authenticateWithPassword.mockClear();

    const res = await attemptLogin(user.email);
    expect(res.status).toBe(429);
    expect(mockAuthKitProvider.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("writes a user.account.locked audit entry when a lock trips", async () => {
    const { user } = await createTestSession();

    for (let i = 0; i < LOGIN_LOCKOUT.THRESHOLDS.FIRST; i++) {
      await attemptLogin(user.email);
    }

    await drainPendingEmits();

    const row = await AuditLogModel.findOne({
      action: "user.account.locked",
    }).lean();
    expect(row).toBeTruthy();
    expect(row?.target?.label).toBe(user.email);
  });

  it("returns the reset-required code for a terminal lock", async () => {
    const { user } = await createTestSession();

    await LoginAttempt.create({
      email: user.email,
      failedCount: LOGIN_LOCKOUT.THRESHOLDS.TERMINAL,
      resetRequired: true,
      lastFailedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const res = await attemptLogin(user.email);
    expect(res.status).toBe(429);
    expect(res.body.messageCode).toBe(
      ERROR_CODES.ACCOUNT_LOCKED_RESET_REQUIRED,
    );
    expect(mockAuthKitProvider.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("clears the counter on a successful login", async () => {
    const { user } = await createTestSession();

    // Three failures, then a success.
    for (let i = 0; i < 3; i++) {
      await attemptLogin(user.email);
    }

    mockAuthKitProvider.authenticateWithPassword.mockResolvedValueOnce({
      user: { id: user.externalUserId, email: user.email },
    });

    const ok = await request(app)
      .post("/api/auth/login")
      .send(buildPasswordLoginPayload({ email: user.email }))
      .set("Accept", "application/json");

    expect(ok.status).toBe(200);
    expect(await LoginAttempt.findOne({ email: user.email })).toBeNull();
  });

  it("clearing a terminal lock via password reset restores login", async () => {
    const { user } = await createTestSession();

    await LoginAttempt.create({
      email: user.email,
      failedCount: LOGIN_LOCKOUT.THRESHOLDS.TERMINAL,
      resetRequired: true,
      lastFailedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // The password-reset flow clears the lock.
    await clearFailedAttempts(user.email);

    mockAuthKitProvider.authenticateWithPassword.mockResolvedValueOnce({
      user: { id: user.externalUserId, email: user.email },
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send(buildPasswordLoginPayload({ email: user.email }))
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
  });

  describe("kill switch off", () => {
    afterEach(() => {
      envConfig.LOGIN_LOCKOUT_ENABLED = true;
    });

    it("never locks and never writes an attempt row", async () => {
      envConfig.LOGIN_LOCKOUT_ENABLED = false;
      const { user } = await createTestSession();

      for (let i = 0; i < LOGIN_LOCKOUT.THRESHOLDS.FIRST + 2; i++) {
        const res = await attemptLogin(user.email);
        expect(res.status).toBe(401);
      }

      expect(await LoginAttempt.findOne({ email: user.email })).toBeNull();
    });
  });
});
