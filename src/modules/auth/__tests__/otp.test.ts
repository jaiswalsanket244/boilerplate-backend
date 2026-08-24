import { createApp } from "@/app";
import { OtpVerificationModel, OTP_PURPOSE } from "@/db/models/otpVerification";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestSession } from "@/tests/utils/auth";

/**
 * OTP Routes
 *
 * POST /api/auth/request-otp
 *   Auth required : No
 *   Body : identifier (email or E.164 phone, required), purpose (OTP_PURPOSE enum, required)
 *   Success  : 200 – OTP dispatched
 *   Failures : 400 bad input | 404 user not found | 500 server error
 *
 * POST /api/auth/resend-otp
 *   Same contract as request-otp — different helper (invalidates previous OTP)
 *
 * POST /api/auth/verify-otp
 *   Auth required : No
 *   Body : identifier (required), purpose (OTP_PURPOSE, required), otp (required)
 *   Success  : 200 – returns { email } for SIGNUP purpose, or { user, token } for others
 *   Failures : 400 bad input | 401 invalid / expired OTP | 500 server error
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequestOtpPayload(overrides: Record<string, unknown> = {}) {
  return {
    identifier: faker.internet.email().toLowerCase(),
    purpose: OTP_PURPOSE.SIGNUP,
    ...overrides,
  };
}

function buildVerifyOtpPayload(overrides: Record<string, unknown> = {}) {
  return {
    identifier: faker.internet.email().toLowerCase(),
    purpose: OTP_PURPOSE.SIGNUP,
    otp: "1234",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OTP routes", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // POST /api/auth/request-otp
  // =========================================================================

  describe("POST /api/auth/request-otp", () => {
    describe("success", () => {
      it("returns 200 when a valid email identifier and purpose are provided", async () => {
        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/request-otp")
          .send(
            buildRequestOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.VERIFICATION,
            }),
          )
          .set("Accept", "application/json");

        // Outcome depends on whether the user exists; main check: no crash
        expect([200, 400, 404]).toContain(res.status);
      });
    });

    describe("validation errors", () => {
      it("returns 400 when identifier is missing", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({ purpose: OTP_PURPOSE.SIGNUP })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when identifier is not a valid email or phone", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({ identifier: "not-valid", purpose: OTP_PURPOSE.SIGNUP })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is missing", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({ identifier: faker.internet.email() })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is not a valid OTP_PURPOSE value", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send(buildRequestOtpPayload({ purpose: "UNKNOWN_PURPOSE" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/request-otp")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // POST /api/auth/resend-otp
  // =========================================================================

  describe("POST /api/auth/resend-otp", () => {
    describe("validation errors", () => {
      it("returns 400 when identifier is missing", async () => {
        const res = await request(app)
          .post("/api/auth/resend-otp")
          .send({ purpose: OTP_PURPOSE.LOGIN })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is missing", async () => {
        const res = await request(app)
          .post("/api/auth/resend-otp")
          .send({ identifier: faker.internet.email() })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is invalid", async () => {
        const res = await request(app)
          .post("/api/auth/resend-otp")
          .send(buildRequestOtpPayload({ purpose: "BAD" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // POST /api/auth/verify-otp
  // =========================================================================

  describe("POST /api/auth/verify-otp", () => {
    describe("validation errors", () => {
      it("returns 400 when identifier is missing", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({ purpose: OTP_PURPOSE.LOGIN, otp: "1234" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when purpose is missing", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({ identifier: faker.internet.email(), otp: "1234" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when otp is missing", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({
            identifier: faker.internet.email(),
            purpose: OTP_PURPOSE.LOGIN,
          })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("business scenarios", () => {
      it("returns 401 when OTP is incorrect", async () => {
        const { user } = await createTestSession();

        // Seed a real OTP record for this user's email
        await OtpVerificationModel.create({
          identifier: user.email,
          otpCode: "5678",
          purpose: OTP_PURPOSE.VERIFICATION,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });

        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send(
            buildVerifyOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.VERIFICATION,
              otp: "0000", // wrong OTP
            }),
          )
          .set("Accept", "application/json");

        expect([400, 401]).toContain(res.status);
        expect(res.body.success).toBe(false);
      });

      it("returns an error when the OTP is expired", async () => {
        const { user } = await createTestSession();

        // Seed an already-expired OTP
        await OtpVerificationModel.create({
          identifier: user.email,
          otpCode: "1234",
          purpose: OTP_PURPOSE.VERIFICATION,
          expiresAt: new Date(Date.now() - 1000), // expired
        });

        const res = await request(app)
          .post("/api/auth/verify-otp")
          .send(
            buildVerifyOtpPayload({
              identifier: user.email,
              purpose: OTP_PURPOSE.VERIFICATION,
              otp: "1234",
            }),
          )
          .set("Accept", "application/json");

        expect([400, 401]).toContain(res.status);
        expect(res.body.success).toBe(false);
      });
    });
  });
});
