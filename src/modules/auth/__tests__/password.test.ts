import { ERROR_CODES } from "@/constants/error-codes";
import { USER_TYPE } from "@/enums";
import { createApp } from "@/app";
import { AuthProviderError } from "@/providers/auth/utils/auth-provider.error";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { mockJwtHelper } from "@/tests/mocks/jwt.mock";
import { createTestSession } from "@/tests/utils/auth";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/auth/reset-password
 *
 * Auth required : No
 * Body         : email (required)returns 401 when the reset token is invalid or expired
 *
 * Success  : 200 – email dispatched
 * Failures : 400 bad input | 400/404 email not found | 500 provider error
 *
 * ---
 *
 * POST /api/auth/update-password
 *
 * Auth required : No
 * Body         : email (required), token (required), password (required, strong)
 *
 * Success  : 200 – password updated
 * Failures : 400 bad input / weak password | 401 invalid / expired token | 500 server error
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResetEmailPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    ...overrides,
  };
}

function buildUpdatePasswordPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: faker.internet.email().toLowerCase(),
    token: faker.string.alphanumeric(32),
    password: "NewPass@123",
    ...overrides,
  };
}

function lastResetLink(): URL {
  const call = mockEmailService.sendEmail.mock.calls.at(-1);
  const html = (call?.[0] as { html: string }).html;
  const href = html.match(/href='([^']+)'/)?.[1];
  return new URL(href as string);
}

vi.mock("@/helpers/jwt", async (importOriginal) => {
  const { mockJwtHelper } = await import("@/tests/mocks/jwt.mock.js");
  const actual = await importOriginal<typeof import("@/helpers/jwt")>();
  return {
    ...actual,
    jwtHelper: mockJwtHelper,
  };
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Password routes", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // POST /api/auth/send-reset-email
  // =========================================================================

  describe("POST /api/auth/reset-password", () => {
    describe("success", () => {
      it("returns 200 when a valid email is sent", async () => {
        const { user } = await createTestSession();

        const res = await request(app)
          .post("/api/auth/reset-password")
          .send(buildResetEmailPayload({ email: user.email }))
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe("validation errors", () => {
      it("returns 400 when email is missing", async () => {
        const res = await request(app)
          .post("/api/auth/reset-password")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when email is malformed", async () => {
        const res = await request(app)
          .post("/api/auth/reset-password")
          .send({ email: "not-an-email" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("reset link email encoding (regression)", () => {
      beforeEach(() => {
        mockJwtHelper.generateToken.mockReturnValue("reset-token-123");
      });

      it("round-trips an email containing '+' (plus-as-space bug)", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          email: "suraj+reset@byldd.com",
        });

        const res = await request(app)
          .post("/api/auth/reset-password")
          .send({ email: user.email })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);

        const link = lastResetLink();
        // Decoded the way the frontend does — the "+" must survive, not become " "
        expect(link.searchParams.get("email")).toBe("suraj+reset@byldd.com");
        // "+" must be percent-encoded in the raw query, never left literal
        expect(link.search).toContain("%2B");
        expect(link.search).not.toContain("email=suraj+reset");
        // token must still be intact alongside it
        expect(link.searchParams.get("token")).toBe("reset-token-123");
      });

      it("leaves a plain email untouched (no double-encoding)", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          email: "plain.user@byldd.com",
        });

        await request(app)
          .post("/api/auth/reset-password")
          .send({ email: user.email })
          .set("Accept", "application/json");

        expect(lastResetLink().searchParams.get("email")).toBe(
          "plain.user@byldd.com",
        );
      });
    });
  });

  // =========================================================================
  // POST /api/auth/update-password
  // =========================================================================

  describe("POST /api/auth/update-password", () => {
    describe("success", () => {
      it("returns 200 when the password udpated successfully", async () => {
        const { user } = await createTestSession();
        mockJwtHelper.verifyToken.mockReturnValue({
          email: user.email,
        });

        const res = await request(app)
          .post("/api/auth/update-password")
          .send(buildUpdatePasswordPayload({ email: user.email }))
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockAuthKitProvider.updateUser).toBeCalled();
      });
    });
    describe("validation errors", () => {
      it("returns 400 when email is missing", async () => {
        const { email: _e, ...payload } = buildUpdatePasswordPayload();

        const res = await request(app)
          .post("/api/auth/update-password")
          .send(payload)
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when token is missing", async () => {
        const { token: _t, ...payload } = buildUpdatePasswordPayload();

        const res = await request(app)
          .post("/api/auth/update-password")
          .send(payload)
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when password is shorter than 8 characters", async () => {
        const res = await request(app)
          .post("/api/auth/update-password")
          .send(buildUpdatePasswordPayload({ password: "Ab1!" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when password has no digit", async () => {
        const res = await request(app)
          .post("/api/auth/update-password")
          .send(buildUpdatePasswordPayload({ password: "Password!" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when password has no special character", async () => {
        const res = await request(app)
          .post("/api/auth/update-password")
          .send(buildUpdatePasswordPayload({ password: "Password1" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("accepts a valid strong password", async () => {
        const { user } = await createTestSession();
        mockJwtHelper.verifyToken.mockReturnValue({ email: user.email });

        const res = await request(app)
          .post("/api/auth/update-password")
          .send(
            buildUpdatePasswordPayload({
              email: user.email,
              password: "Passw0rd!",
            }),
          )
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/update-password")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("business scenarios", () => {
      it("returns 401 when the reset token is invalid or expired", async () => {
        mockJwtHelper.verifyToken.mockImplementation(() => {
          throw new Error("jwt expired");
        });

        const res = await request(app)
          .post("/api/auth/update-password")
          .send(buildUpdatePasswordPayload({ token: "invalid-token" }))
          .set("Accept", "application/json");

        // 401 by design — the client treats a dead reset token as an expired
        // session and redirects the user to sign-in.
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 with a messageCode when the password is too weak", async () => {
        // A weak/reused password is a validation error, not an auth failure.
        // Returning 400 keeps the frontend's 401 interceptor from redirecting.
        const { user } = await createTestSession(USER_TYPE.ADMIN);
        mockJwtHelper.verifyToken.mockReturnValue({ email: user.email });
        mockAuthKitProvider.updateUser.mockRejectedValue(
          new AuthProviderError("Your password is too weak.", {
            code: ERROR_CODES.PASSWORD_TOO_WEAK,
          }),
        );

        const res = await request(app)
          .post("/api/auth/update-password")
          .send(buildUpdatePasswordPayload({ email: user.email }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.messageCode).toBe(ERROR_CODES.PASSWORD_TOO_WEAK);
      });
    });
  });
});
