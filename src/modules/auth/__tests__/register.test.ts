import { createApp } from "@/app";
import { User } from "@/db/models/user";
import { Company } from "@/db/models/company";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";

/** Builds a valid registration payload */
function buildRegisterPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    email: faker.internet.email().toLowerCase(),
    password: "StrongPass@123",
    ...overrides,
  };
}

/** A fake external-provider user object (like a WorkOS User) */
function buildAuthProviderUser(id = faker.string.uuid()) {
  return {
    id,
    email: faker.internet.email(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    emailVerified: true,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/auth/register", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path stubs
    mockAuthKitProvider.createUser.mockResolvedValue(buildAuthProviderUser());
    mockAuthKitProvider.updateUser.mockResolvedValue(buildAuthProviderUser());
  });

  describe("success", () => {
    it("returns 200 with user data when valid credentials are sent (web client)", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      expect(res.body.data).toHaveProperty("user");
      expect(res.body.data.user).toHaveProperty("email", payload.email);
    });

    it("sets pending MFA cookie and asks for MFA setup on successful registration (web client)", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      // MFA enrollment is required at signup — no session cookie yet,
      // only a pending MFA token cookie and a redirect hint.
      const cookies = res.headers["set-cookie"] as unknown as string[];
      expect(cookies).toBeDefined();

      const hasPendingMfaCookie = cookies.some((c: string) =>
        c.startsWith("pendingMfaToken="),
      );
      expect(hasPendingMfaCookie).toBe(true);

      const hasSessionCookie = cookies.some((c: string) =>
        c.startsWith("token="),
      );
      expect(hasSessionCookie).toBe(false);

      expect(res.body.data).toHaveProperty("redirectToMfaSetup", true);
    });

    // TODO: Mobile MFA enrollment flow is incomplete — when MFA is required at
    // signup, mobile clients receive neither a session token nor the pending
    // MFA token (it is only set as a web cookie). Unskip once that flow is built.
    it.skip("returns token in response body for mobile clients", async () => {
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json")
        .set("x-client-platform", "mobile");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("token");
      expect(res.body.data).toHaveProperty("user");
      expect(typeof res.body.data.token).toBe("string");
    });

    it("creates a User document in the database", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });

      expect(dbUser).not.toBeNull();
      expect(dbUser?.email).toBe(payload.email);
      expect(dbUser?.name.first).toBe(payload.name.first);
      expect(dbUser?.name.last).toBe(payload.name.last);
    });

    it("creates a Company and links it to the new admin user", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      const company = await Company.findById(dbUser?.companyRef);

      expect(company).not.toBeNull();
      expect(company?.userRef?.toString()).toBe(dbUser?._id.toString());
    });

    it("calls AuthService.createUser once with correct arguments", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).toHaveBeenCalledOnce();
      expect(mockAuthKitProvider.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: payload.email,
          firstName: payload.name.first,
          lastName: payload.name.last,
          emailVerified: true,
        }),
      );
    });

    it("passes externalId to AuthService.createUser to link the provider record to the DB user", async () => {
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: expect.any(String) }),
      );
    });

    it("stores externalUserId on the user document (from auth provider)", async () => {
      const externalId = faker.string.uuid();
      mockAuthKitProvider.createUser.mockResolvedValue(
        buildAuthProviderUser(externalId),
      );
      const payload = buildRegisterPayload();

      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      const dbUser = await User.findOne({ email: payload.email });
      expect(dbUser?.externalUserId).toBe(externalId);
    });
  });

  // =========================================================================
  // 2. Validation Errors (confused user)
  // =========================================================================

  describe("validation errors", () => {
    it("returns 400 when email is missing", async () => {
      const { email: _email, ...payload } = buildRegisterPayload() as any;

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when email is malformed", async () => {
      const payload = buildRegisterPayload({ email: "not-an-email" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is missing", async () => {
      const { password: _pw, ...payload } = buildRegisterPayload() as any;

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password is shorter than 8 characters", async () => {
      const payload = buildRegisterPayload({ password: "Ab1!" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password has no letter", async () => {
      const payload = buildRegisterPayload({ password: "12345678!" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password has no digit", async () => {
      const payload = buildRegisterPayload({ password: "Password!" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when password has no special character", async () => {
      const payload = buildRegisterPayload({ password: "Password1" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("accepts a valid strong password (min length + letter + digit + special)", async () => {
      const payload = buildRegisterPayload({ password: "Passw0rd!" });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 when name.first is missing", async () => {
      const payload = buildRegisterPayload({ name: { last: "Doe" } });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when name.last is missing", async () => {
      const payload = buildRegisterPayload({ name: { first: "John" } });

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when the entire name field is missing", async () => {
      const { name: _name, ...payload } = buildRegisterPayload() as any;

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when the request body is empty", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({})
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("does NOT call the auth provider when validation fails", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ email: "bad-email" })
        .set("Accept", "application/json");

      expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Business Scenarios (malicious / duplicate user)
  // =========================================================================

  describe("business scenarios", () => {
    it("returns 409 when a user with the same email already exists", async () => {
      const payload = buildRegisterPayload();

      // First registration — succeeds
      await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      // Reset stub so the provider would allow a second create
      mockAuthKitProvider.createUser.mockResolvedValue(buildAuthProviderUser());

      // Second registration with same email — must conflict
      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("does not call AuthService.createUser when email already exists", async () => {
      const payload = buildRegisterPayload();

      // Seed an existing user directly in DB
      await User.create({
        email: payload.email,
        name: payload.name,
        externalUserId: faker.string.uuid(),
        hasPassword: true,
      });

      vi.clearAllMocks();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(409);
      expect(mockAuthKitProvider.createUser).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. External / Server Failures (3 AM engineer)
  // =========================================================================

  describe("server errors", () => {
    it("returns 500 when the auth provider createUser throws", async () => {
      mockAuthKitProvider.createUser.mockRejectedValueOnce(
        new Error("WorkOS is down"),
      );
      const payload = buildRegisterPayload();

      const res = await request(app)
        .post("/api/auth/register")
        .send(payload)
        .set("Accept", "application/json");

      expect(res.status).toBe(500);
    });
  });
});
