import { createApp } from "@/app";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mockAuthKitProvider,
  workos,
} from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";
import { STATUS, USER_TYPE } from "@/enums";
import { ERROR_CODES } from "@/constants/error-codes";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { LoginAttempt } from "@/db/models/loginAttempt";
import { ErrorLogs } from "@/db/models/errorLogs";
import { drainPendingEmits } from "@/modules/audit-logs/helpers/emit.helper";
import { recordFailedAttempt } from "@/modules/auth/helpers/lockout.helper";
import envConfig from "@/config/env";
import { jwtHelper } from "@/helpers/jwt";
import {
  SYSTEM_SUBSYSTEM_REFS,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/login
 *
 * Auth required : No
 * Body : email (required), password (optional), loginType (required: "password"|"otp"), otp (optional)
 *
 * Success  : 200 – sets cookie (web) / returns token (mobile)
 * Failures : 400 bad input | 401 wrong credentials / disabled account | 500 server error
 */

function buildPasswordLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    loginType: "password",
    ...overrides,
  };
}

function buildOtpLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    loginType: "otp",
    otp: "1234",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy Path (password login)
  // =========================================================================

  describe("success — password login", () => {
    it("returns 200 with user data for a valid password login (web)", async () => {
      // Seed a real user and stub the provider to authenticate them
      const { user } = await createTestSession();

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("user");
    });

    it("sets auth cookies on successful password login (web)", async () => {
      const { user } = await createTestSession();

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      const cookies = res.headers["set-cookie"] as unknown as string[];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.startsWith("token="))).toBe(true);
    });

    it("returns token in response body for mobile clients (password login)", async () => {
      const { user } = await createTestSession();

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("token");
      expect(typeof res.body.data.token).toBe("string");
    });
  });

  // =========================================================================
  // 1b. MFA gate — no session may be issued before the challenge is answered
  // =========================================================================

  describe("mfa gate — password login", () => {
    const enrolledMfa = {
      mfa: { enrolled: true, enabled: true, factorId: "auth_factor_test" },
    };

    it("challenges instead of issuing a session when mongo has mfa enrolled (web)", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, enrolledMfa);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_1" });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);
      expect(res.body.data).not.toHaveProperty("token");
    });

    it("challenges instead of issuing a session on mobile", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, enrolledMfa);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_3" });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);
      expect(res.body.data).not.toHaveProperty("token");
      expect(res.body.data).not.toHaveProperty("refreshToken");
      expect(res.body.data.pendingMfaToken).toEqual(expect.any(String));
      expect(res.body.data.mfaChallengeId).toBe("auth_challenge_3");
    });

    it("completes the mobile challenge with the pending token header", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, enrolledMfa);

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_4" });
      workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });

      const login = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      const { pendingMfaToken, mfaChallengeId } = login.body.data;

      const res = await request(app)
        .post("/api/auth/mfa/verify")
        .send({ code: "123456", mfaChallengeId })
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile")
        .set("x-pending-mfa-token", pendingMfaToken);

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
    });

    it("challenges when the provider requires mfa but mongo is out of sync", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: { enrolled: false, enabled: false, factorId: "auth_factor_test" },
      });

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
        mfaRequired: true,
      });
      workos.mfa.challengeFactor.mockResolvedValue({ id: "auth_challenge_2" });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.messageCode).toBe(ERROR_CODES.MFA_REQUIRED);

      const cookies = (res.headers["set-cookie"] ?? []) as unknown as string[];
      expect(cookies.some((c: string) => c.startsWith("token="))).toBe(false);
    });

    it("refuses login when mfa is required but no factor is registered", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        mfa: { enrolled: true, enabled: true },
      });

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.MFA_FACTOR_MISSING);
    });
  });

  // =========================================================================
  // 2. Validation Errors (confused user)
  // =========================================================================

  describe("validation errors", () => {
    it("returns 400 when email is missing", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ password: "pass123", loginType: "password" })
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when email is malformed", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: "not-an-email" }))
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when loginType is missing", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: faker.internet.email(), password: "pass123" })
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when loginType is an invalid value", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ loginType: "magic" }))
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is shorter than 6 characters", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ password: "abc" }))
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when otp is not 4 digits for otp loginType", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send(buildOtpLoginPayload({ otp: "12" }))
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when request body is empty", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({})
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("does NOT call the auth provider when validation fails", async () => {
      await request(app)
        .post("/api/auth/login")
        .send({ email: "bad-email", loginType: "password" })
        .set("Accept", "application/json");

      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Business Scenarios (wrong credentials, disabled account)
  // =========================================================================

  describe("business scenarios", () => {
    it("returns 401 when credentials are invalid", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: "ghost@example.com" }))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("returns 401 when the account is disabled", async () => {
      const { user } = await createTestSession(USER_TYPE.ADMIN, {
        status: STATUS.INACTIVE,
      });

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      // Account is INACTIVE — controller should refuse login
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 4. Server Errors (3 AM engineer)
  // =========================================================================

  describe("server errors", () => {
    it("returns 401 (not 500) when the auth provider throws during password authentication", async () => {
      // With lockout enabled a wrong password / provider throw is caught, the
      // attempt is counted, and the caller gets a clean 401 — no 500, no
      // ErrorLogs row.
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValueOnce(
        new Error("Provider is down"),
      );

      const { user } = await createTestSession();

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 6. Account lockout (brute-force protection)
  // =========================================================================

  describe("account lockout", () => {
    // Drives one failed password attempt and returns the response.
    const failLogin = (email: string) =>
      request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email }))
        .set("Accept", "application/json");

    // Pretend an active timed lock has elapsed so the next attempt is allowed.
    const expireTimedLock = (email: string) =>
      LoginAttempt.updateOne(
        { email },
        { $set: { lockedUntil: new Date(Date.now() - 1000) } },
      );

    it("locks the account at exactly 5 / 10 / 15 failed attempts", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("bad password"),
      );

      // Attempts 1–4: allowed through to a 401.
      for (let i = 0; i < 4; i++) {
        expect((await failLogin(user.email)).status).toBe(401);
      }

      // 5th failure → temporary lock.
      const fifth = await failLogin(user.email);
      expect(fifth.status).toBe(429);
      expect(fifth.body.messageCode).toBe(ERROR_CODES.ACCOUNT_LOCKED);

      await expireTimedLock(user.email);

      // 6–9: allowed again (401), 10th → second lock.
      for (let i = 0; i < 4; i++) {
        expect((await failLogin(user.email)).status).toBe(401);
      }
      const tenth = await failLogin(user.email);
      expect(tenth.status).toBe(429);
      expect(tenth.body.messageCode).toBe(ERROR_CODES.ACCOUNT_LOCKED);
      expect(
        (await LoginAttempt.findOne({ email: user.email }))?.failedCount,
      ).toBe(10);

      await expireTimedLock(user.email);

      // 11–14: allowed, 15th → terminal lock requiring a reset.
      for (let i = 0; i < 4; i++) {
        expect((await failLogin(user.email)).status).toBe(401);
      }
      const fifteenth = await failLogin(user.email);
      expect(fifteenth.status).toBe(429);
      expect(fifteenth.body.messageCode).toBe(
        ERROR_CODES.ACCOUNT_LOCKED_RESET_REQUIRED,
      );

      const record = await LoginAttempt.findOne({ email: user.email });
      expect(record?.failedCount).toBe(15);
      expect(record?.resetRequired).toBe(true);
    });

    it("returns 429 without ever calling the auth provider while locked", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("bad password"),
      );

      // Trip the lock.
      for (let i = 0; i < 5; i++) await failLogin(user.email);

      mockAuthKitProvider.authenticateWithPassword.mockClear();

      const res = await failLogin(user.email);

      expect(res.status).toBe(429);
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("writes a user.account.locked audit entry when a lock trips", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("bad password"),
      );

      for (let i = 0; i < 5; i++) await failLogin(user.email);

      await drainPendingEmits();

      const row = await AuditLogModel.findOne({
        action: "user.account.locked",
      }).lean();
      expect(row).toBeTruthy();
      expect(row?.target?.label).toBe(user.email);
    });

    it("clears a terminal lock when the password is reset", async () => {
      const { user } = await createTestSession();

      // Seed a terminal lock directly.
      await LoginAttempt.create({
        email: user.email,
        failedCount: 15,
        resetRequired: true,
      });

      mockAuthKitProvider.updateUser.mockResolvedValue({
        id: user.externalUserId,
        email: user.email,
      });

      const token = jwtHelper.generateToken({ email: user.email }, "1h");

      const res = await request(app)
        .post("/api/auth/update-password")
        .send({ email: user.email, password: "NewPass@123", token })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(await LoginAttempt.findOne({ email: user.email })).toBeNull();
    });

    it("returns 401 and writes no ErrorLogs row on a wrong password", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
        new Error("bad password"),
      );

      const res = await failLogin(user.email);

      expect(res.status).toBe(401);
      expect(await ErrorLogs.countDocuments()).toBe(0);
    });

    it("does not lose increments under concurrent failures", async () => {
      // Exercised at the helper level so the assertion targets the atomic $inc
      // itself, not the HTTP lock-gate (which would legitimately reject a racing
      // request once the lock trips).
      const email = "race@example.com";

      await Promise.all(
        Array.from({ length: 5 }, () => recordFailedAttempt(email)),
      );

      const record = await LoginAttempt.findOne({ email });
      expect(record?.failedCount).toBe(5);
    });

    describe("kill switch off", () => {
      beforeEach(() => {
        envConfig.LOGIN_LOCKOUT_ENABLED = false;
      });
      afterEach(() => {
        envConfig.LOGIN_LOCKOUT_ENABLED = true;
      });

      it("restores the original behaviour: provider throw → 500, no lock record", async () => {
        const { user } = await createTestSession();
        mockAuthKitProvider.authenticateWithPassword.mockRejectedValue(
          new Error("Provider is down"),
        );

        const res = await failLogin(user.email);

        expect(res.status).toBe(500);
        expect(await LoginAttempt.findOne({ email: user.email })).toBeNull();
      });
    });
  });

  // =========================================================================
  // 5. Audit logging
  // =========================================================================

  describe("audit logging", () => {
    it("writes a user.login.success entry on the tenant chain", async () => {
      const { user, company } = await createTestSession();

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
        user: { id: user.externalUserId, email: user.email },
      });

      await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      await drainPendingEmits();

      const row = await AuditLogModel.findOne({
        action: "user.login.success",
      }).lean();
      expect(row).toBeTruthy();
      expect(row?.actorId?.toString()).toBe(user._id.toString());
      expect(row?.companyRef?.toString()).toBe(company._id.toString());
    });

    it("writes a sanitized user.login.failure entry on the AUTH sentinel chain", async () => {
      // Unknown account — the reason must NOT reveal that the email is unknown.
      await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: "ghost@example.com" }))
        .set("Accept", "application/json");

      await drainPendingEmits();

      const row = await AuditLogModel.findOne({
        action: "user.login.failure",
      }).lean();
      expect(row).toBeTruthy();
      expect(row?.failureReason).toBe("Invalid credentials");
      expect(row?.target?.label).toBe("ghost@example.com");
      expect(row?.companyRef?.toString()).toBe(
        SYSTEM_SUBSYSTEM_REFS[SystemSubsystem.AUTH].toString(),
      );
    });

    it("writes a user.logout entry attributed to the token's actor", async () => {
      const { user, cookie } = await createTestSession();

      await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookie)
        .set("Accept", "application/json");

      await drainPendingEmits();

      const row = await AuditLogModel.findOne({ action: "user.logout" }).lean();
      expect(row).toBeTruthy();
      expect(row?.actorId?.toString()).toBe(user._id.toString());
    });
  });
});
