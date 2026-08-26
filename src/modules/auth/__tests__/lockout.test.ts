import { createApp } from "@/app";
import envConfig from "@/config/env";
import { ERROR_CODES } from "@/constants/error-codes";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { ErrorLogs } from "@/db/models/errorLogs";
import { LoginAttempt } from "@/db/models/loginAttempt";
import { jwtHelper } from "@/helpers/jwt";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import {
  clearFailedAttempts,
  evaluateLockState,
  recordFailedAttempt,
} from "@/modules/auth/helpers/lockout.helper";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Account lockout — CYR-47
 *
 * Behaviour table (failed attempts -> result):
 *   1-4  allowed | 5 -> 5m lock | 10 -> 30m lock | 15 -> until password reset
 */

const app = createApp();

function buildPasswordLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    loginType: "password",
    ...overrides,
  };
}

function wrongPasswordLogin(email: string) {
  return request(app)
    .post("/api/auth/login")
    .send(buildPasswordLoginPayload({ email }))
    .set("Accept", "application/json");
}

describe("Account lockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // State machine — precise threshold + duration behaviour (injectable clock)
  // =========================================================================

  describe("state machine", () => {
    it("locks at exactly 5, 10 and 15 failures with escalating severity", async () => {
      const email = faker.internet.email().toLowerCase();
      let now = new Date("2026-01-01T00:00:00.000Z");
      const advancePast = (ms: number) => {
        now = new Date(now.getTime() + ms + 1000);
      };

      // 1-4: allowed
      for (let i = 1; i <= 4; i++) {
        expect((await recordFailedAttempt(email, now)).justLocked).toBe(false);
      }

      // 5th: 5 minute lock
      expect(await recordFailedAttempt(email, now)).toMatchObject({
        failedCount: 5,
        justLocked: true,
        resetRequired: false,
      });
      expect((await evaluateLockState(email, now)).locked).toBe(true);
      advancePast(LOGIN_LOCKOUT.DURATIONS_MS.TEMPORARY);
      expect(await evaluateLockState(email, now)).toEqual({ locked: false });

      // 6-9: allowed (no decay — the counter kept its value through the lock)
      for (let i = 6; i <= 9; i++) {
        expect((await recordFailedAttempt(email, now)).justLocked).toBe(false);
      }

      // 10th: 30 minute lock
      expect(await recordFailedAttempt(email, now)).toMatchObject({
        failedCount: 10,
        justLocked: true,
        resetRequired: false,
      });
      const midExtended = new Date(
        now.getTime() + LOGIN_LOCKOUT.DURATIONS_MS.EXTENDED - 1000,
      );
      expect((await evaluateLockState(email, midExtended)).locked).toBe(true);
      advancePast(LOGIN_LOCKOUT.DURATIONS_MS.EXTENDED);
      expect(await evaluateLockState(email, now)).toEqual({ locked: false });

      // 11-14: allowed
      for (let i = 11; i <= 14; i++) {
        expect((await recordFailedAttempt(email, now)).justLocked).toBe(false);
      }

      // 15th: terminal — locked until reset, never TTL-reaped
      expect(await recordFailedAttempt(email, now)).toMatchObject({
        failedCount: 15,
        justLocked: true,
        resetRequired: true,
      });
      const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      expect(await evaluateLockState(email, farFuture)).toEqual({
        locked: true,
        resetRequired: true,
      });
      const record = await LoginAttempt.findOne({ email }).lean();
      expect(record?.expiresAt).toBeNull();
    });

    it("clearFailedAttempts removes the record", async () => {
      const email = faker.internet.email().toLowerCase();
      await recordFailedAttempt(email);
      await clearFailedAttempts(email);
      expect(await LoginAttempt.findOne({ email }).lean()).toBeNull();
    });

    it("does not lose increments under concurrent failures", async () => {
      const email = faker.internet.email().toLowerCase();
      const attempts = 12;

      await Promise.all(
        Array.from({ length: attempts }, () => recordFailedAttempt(email)),
      );

      const record = await LoginAttempt.findOne({ email }).lean();
      expect(record?.failedCount).toBe(attempts);
    });
  });

  // =========================================================================
  // Login endpoint integration
  // =========================================================================

  describe("login endpoint", () => {
    it("locks after 5 wrong passwords and 429s the next attempt without calling WorkOS", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("Invalid email or password"),
      );

      for (let i = 1; i <= 5; i++) {
        const res = await wrongPasswordLogin(user.email);
        expect(res.status).toBe(401);
      }

      // The 6th attempt must be rejected before the provider is consulted.
      mockAuthKitProvider.authenticateWithPassword.mockClear();
      const blocked = await wrongPasswordLogin(user.email);

      expect(blocked.status).toBe(429);
      expect(blocked.body.messageCode).toBe(ERROR_CODES.ACCOUNT_LOCKED);
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("returns 401 and writes no ErrorLogs row on a wrong password", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("Invalid email or password"),
      );

      const res = await wrongPasswordLogin(user.email);

      expect(res.status).toBe(401);
      expect(await ErrorLogs.findOne({}).lean()).toBeNull();
    });

    it("returns 429 with the reset-required code for a terminal lock", async () => {
      const { user } = await createTestSession();
      await LoginAttempt.create({
        email: user.email,
        failedCount: LOGIN_LOCKOUT.THRESHOLDS.TERMINAL,
        resetRequired: true,
        lockedUntil: null,
        expiresAt: null,
        lastFailedAt: new Date(),
      });

      const res = await wrongPasswordLogin(user.email);

      expect(res.status).toBe(429);
      expect(res.body.messageCode).toBe(
        ERROR_CODES.ACCOUNT_LOCKED_RESET_REQUIRED,
      );
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("emits a user.account.locked audit entry when the account locks", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("Invalid email or password"),
      );

      for (let i = 1; i <= LOGIN_LOCKOUT.THRESHOLDS.TEMPORARY; i++) {
        await wrongPasswordLogin(user.email);
      }
      await drainPendingEmits();

      const row = await AuditLogModel.findOne({
        action: "user.account.locked",
      }).lean();
      expect(row).toBeTruthy();
      expect(row?.target?.label).toBe(user.email);
    });

    it("clears the counter on a successful login", async () => {
      const { user } = await createTestSession();

      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("Invalid email or password"),
      );
      for (let i = 1; i <= 3; i++) await wrongPasswordLogin(user.email);
      expect(
        (await LoginAttempt.findOne({ email: user.email }).lean())?.failedCount,
      ).toBe(3);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      const ok = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(ok.status).toBe(200);
      expect(
        await LoginAttempt.findOne({ email: user.email }).lean(),
      ).toBeNull();
    });
  });

  // =========================================================================
  // Kill switch — disabled must restore the pre-lockout behaviour exactly
  // =========================================================================

  describe("kill switch off", () => {
    let original: boolean;
    beforeEach(() => {
      original = envConfig.LOGIN_LOCKOUT_ENABLED;
      envConfig.LOGIN_LOCKOUT_ENABLED = false;
    });
    afterEach(() => {
      envConfig.LOGIN_LOCKOUT_ENABLED = original;
    });

    it("returns the legacy 500 on a provider error and never locks", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("Provider is down"),
      );

      for (let i = 1; i <= 6; i++) {
        const res = await wrongPasswordLogin(user.email);
        expect(res.status).toBe(500);
      }

      expect(
        await LoginAttempt.findOne({ email: user.email }).lean(),
      ).toBeNull();
    });
  });

  // =========================================================================
  // Password reset lifts a terminal lock
  // =========================================================================

  describe("password reset", () => {
    it("clears a terminal lock", async () => {
      const { user } = await createTestSession();
      await LoginAttempt.create({
        email: user.email,
        failedCount: LOGIN_LOCKOUT.THRESHOLDS.TERMINAL,
        resetRequired: true,
        lockedUntil: null,
        expiresAt: null,
        lastFailedAt: new Date(),
      });

      mockAuthKitProvider.updateUser.mockResolvedValue({
        id: user.externalUserId,
        email: user.email,
      });

      const res = await request(app)
        .post("/api/auth/update-password")
        .send({
          email: user.email,
          password: "BrandNew@123",
          token: jwtHelper.generateToken({ email: user.email }, "1h"),
        })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(
        await LoginAttempt.findOne({ email: user.email }).lean(),
      ).toBeNull();
    });
  });
});
