import { createApp } from "@/app";
import { ERROR_CODES } from "@/constants/error-codes";
import envConfig from "@/config/env";
import { ErrorLogs } from "@/db/models/errorLogs";
import { LoginAttempt } from "@/db/models/loginAttempt";
import {
  clearFailedAttempts,
  evaluateLockState,
  recordFailedAttempt,
} from "@/modules/auth/helpers/lockout.helper";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { mockJwtHelper } from "@/tests/mocks/jwt.mock";
import { createTestSession } from "@/tests/utils/auth";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/jwt", async (importOriginal) => {
  const { mockJwtHelper } = await import("@/tests/mocks/jwt.mock.js");
  const actual = await importOriginal<typeof import("@/helpers/jwt")>();
  return { ...actual, jwtHelper: mockJwtHelper };
});

function buildPasswordLoginPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    loginType: "password",
    ...overrides,
  };
}

const { THRESHOLDS } = LOGIN_LOCKOUT;

describe("Account lockout", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Helper-level behaviour — exact thresholds & atomicity
  // =========================================================================

  describe("lockout helper", () => {
    it("locks temporarily at exactly the FIRST threshold, not before", async () => {
      const email = faker.internet.email().toLowerCase();

      for (let i = 1; i < THRESHOLDS.FIRST; i++) {
        const { trigger } = await recordFailedAttempt(email);
        expect(trigger).toBeNull();
        expect((await evaluateLockState(email)).locked).toBe(false);
      }

      const { trigger } = await recordFailedAttempt(email);
      expect(trigger).toBe("FIRST");

      const state = await evaluateLockState(email);
      expect(state.locked).toBe(true);
      expect(state.resetRequired).toBe(false);
    });

    it("escalates to the SECOND threshold once the first lock is cleared", async () => {
      const email = faker.internet.email().toLowerCase();

      for (let i = 0; i < THRESHOLDS.SECOND - 1; i++) {
        await recordFailedAttempt(email);
      }
      // Expire the temporary lock the FIRST threshold placed, without resetting
      // the counter (mirrors the lock window elapsing).
      await LoginAttempt.updateOne(
        { email },
        { $set: { lockedUntil: new Date(Date.now() - 1000) } },
      );
      expect((await evaluateLockState(email)).locked).toBe(false);

      const { trigger } = await recordFailedAttempt(email);
      expect(trigger).toBe("SECOND");
      expect((await evaluateLockState(email)).locked).toBe(true);
    });

    it("places a terminal reset-required lock at the TERMINAL threshold", async () => {
      const email = faker.internet.email().toLowerCase();

      let lastTrigger: string | null = null;
      for (let i = 0; i < THRESHOLDS.TERMINAL; i++) {
        lastTrigger = (await recordFailedAttempt(email)).trigger;
      }

      expect(lastTrigger).toBe("TERMINAL");

      const state = await evaluateLockState(email);
      expect(state.locked).toBe(true);
      expect(state.resetRequired).toBe(true);

      // Terminal locks drop the TTL field so the sweep can't auto-unlock them.
      const doc = await LoginAttempt.findOne({ email }).lean();
      expect(doc?.expiresAt ?? null).toBeNull();
    });

    it("does not lose increments under concurrent failures", async () => {
      const email = faker.internet.email().toLowerCase();
      const bursts = THRESHOLDS.SECOND; // 10 simultaneous failures

      await Promise.all(
        Array.from({ length: bursts }, () => recordFailedAttempt(email)),
      );

      const doc = await LoginAttempt.findOne({ email }).lean();
      expect(doc?.failedCount).toBe(bursts);
    });

    it("clearFailedAttempts removes every trace of the counter", async () => {
      const email = faker.internet.email().toLowerCase();
      for (let i = 0; i < THRESHOLDS.TERMINAL; i++) {
        await recordFailedAttempt(email);
      }

      await clearFailedAttempts(email);

      expect(await LoginAttempt.findOne({ email }).lean()).toBeNull();
      expect((await evaluateLockState(email)).locked).toBe(false);
    });
  });

  // =========================================================================
  // Login endpoint integration
  // =========================================================================

  describe("POST /api/auth/login", () => {
    it("returns 429 for a locked account without calling the auth provider", async () => {
      const { user } = await createTestSession();
      await LoginAttempt.create({
        email: user.email,
        failedCount: THRESHOLDS.FIRST,
        lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT.DURATIONS_MS.FIRST),
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(429);
      expect(res.body.messageCode).toBe(ERROR_CODES.ACCOUNT_LOCKED);
      expect(
        mockAuthKitProvider.authenticateWithPassword,
      ).not.toHaveBeenCalled();
    });

    it("returns the reset-required code for a terminal lock", async () => {
      const { user } = await createTestSession();
      await LoginAttempt.create({
        email: user.email,
        failedCount: THRESHOLDS.TERMINAL,
        resetRequired: true,
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(429);
      expect(res.body.messageCode).toBe(
        ERROR_CODES.ACCOUNT_LOCKED_RESET_REQUIRED,
      );
    });

    it("counts a rejected password and clears the counter on success", async () => {
      const { user } = await createTestSession();

      mockAuthKitProvider.authenticateWithPassword.mockRejectedValueOnce(
        new Error("Invalid email or password"),
      );

      const failed = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(failed.status).toBe(401);
      expect(await ErrorLogs.countDocuments()).toBe(0);
      expect((await LoginAttempt.findOne({ email: user.email }))?.failedCount).toBe(1);

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
  });

  // =========================================================================
  // Password reset clears a terminal lock
  // =========================================================================

  describe("password reset", () => {
    it("clears a terminal lock so the account can log in again", async () => {
      const { user } = await createTestSession();
      await LoginAttempt.create({
        email: user.email,
        failedCount: THRESHOLDS.TERMINAL,
        resetRequired: true,
      });

      mockJwtHelper.verifyToken.mockReturnValue({ email: user.email });
      mockAuthKitProvider.updateUser.mockResolvedValue({
        id: user.externalUserId,
        email: user.email,
      });

      const reset = await request(app)
        .post("/api/auth/update-password")
        .send({
          email: user.email,
          token: faker.string.alphanumeric(32),
          password: "BrandNew@123",
        })
        .set("Accept", "application/json");

      expect(reset.status).toBe(200);
      expect(await LoginAttempt.findOne({ email: user.email })).toBeNull();
    });
  });

  // =========================================================================
  // Kill switch — disabled must restore prior behaviour exactly
  // =========================================================================

  describe("kill switch disabled", () => {
    beforeEach(() => {
      envConfig.LOGIN_LOCKOUT_ENABLED = false;
    });
    afterEach(() => {
      envConfig.LOGIN_LOCKOUT_ENABLED = true;
    });

    it("never records attempts or blocks a pre-existing lock", async () => {
      const { user } = await createTestSession();
      // A lock document exists, but with the switch off it must be ignored.
      await LoginAttempt.create({
        email: user.email,
        failedCount: THRESHOLDS.TERMINAL,
        resetRequired: true,
      });

      mockAuthKitProvider.authenticateWithPassword.mockResolvedValueOnce({
        user: { id: user.externalUserId, email: user.email },
      });

      const res = await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
    });

    it("does not write a counter for a rejected password", async () => {
      const { user } = await createTestSession();
      mockAuthKitProvider.authenticateWithPassword.mockRejectedValueOnce(
        new Error("Invalid email or password"),
      );

      await request(app)
        .post("/api/auth/login")
        .send(buildPasswordLoginPayload({ email: user.email }))
        .set("Accept", "application/json");

      expect(await LoginAttempt.findOne({ email: user.email })).toBeNull();
    });
  });
});
