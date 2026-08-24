import { createApp } from "@/app";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";
import { STATUS, USER_TYPE } from "@/enums";
import { Company } from "@/db/models/company";
import { User } from "@/db/models/user";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";

/**
 * OAuth Routes
 *
 * GET /api/auth/url/oauth?provider=<SOCIAL_OAUTH_METHOD>
 *   Auth required : No
 *   Query : provider (required, enum SOCIAL_OAUTH_METHOD), redirectUrl (optional)
 *   Success  : 200 – returns { redirectUrl }
 *   Failures : 400 invalid provider | 500 provider error
 *
 * POST /api/auth/social-signup
 *   Auth required : No
 *   Body : code (required), oauthProvider (required, enum), inviteToken (optional)
 *   Success  : 200 – sets cookie (web) / returns token (mobile)
 *   Failures : 400 bad input | 500 provider error
 */

const VALID_OAUTH_PROVIDER = SOCIAL_OAUTH_METHOD.GOOGLE; // adjust to a real value from SOCIAL_OAUTH_METHOD

function buildOauthRegisterPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: faker.string.alphanumeric(32),
    oauthProvider: VALID_OAUTH_PROVIDER,
    ...overrides,
  };
}

function oauthProviderReturns(
  profile: {
    email: string;
    id?: string;
    firstName?: string;
    lastName?: string;
  },
  metadata: Record<string, unknown> = {},
) {
  mockAuthKitProvider.authenticateWithCode.mockResolvedValue({
    user: { id: faker.string.uuid(), metadata, ...profile },
  });
}

describe("OAuth routes", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // GET /api/auth/oauth-url
  // =========================================================================

  describe("GET /api/auth/url/oauth", () => {
    describe("success", () => {
      it("returns 200 with a redirectUrl when a valid provider is given", async () => {
        const fakeUrl = "https://sso.workos.com/authorize?...";
        mockAuthKitProvider.generateOAuthUrl.mockResolvedValue(fakeUrl);

        const res = await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: VALID_OAUTH_PROVIDER })
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("redirectUrl");
      });

      it("calls AuthService.generateOAuthUrl with the correct provider", async () => {
        const fakeUrl = "https://sso.workos.com/authorize?...";
        mockAuthKitProvider.generateOAuthUrl.mockResolvedValue(fakeUrl);

        await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: VALID_OAUTH_PROVIDER })
          .set("Accept", "application/json");

        expect(mockAuthKitProvider.generateOAuthUrl).toHaveBeenCalledOnce();
        expect(mockAuthKitProvider.generateOAuthUrl).toHaveBeenCalledWith(
          expect.objectContaining({ provider: VALID_OAUTH_PROVIDER }),
        );
      });
    });

    describe("validation errors", () => {
      it("returns 400 when provider query param is missing", async () => {
        const res = await request(app)
          .get("/api/auth/url/oauth")
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when provider is not a valid SOCIAL_OAUTH_METHOD value", async () => {
        const res = await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: "FakeProvider" })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("does NOT call the auth service when validation fails", async () => {
        await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: "FakeProvider" })
          .set("Accept", "application/json");

        expect(mockAuthKitProvider.generateOAuthUrl).not.toHaveBeenCalled();
      });
    });

    describe("server errors", () => {
      it("returns 500 when generateOAuthUrl throws", async () => {
        mockAuthKitProvider.generateOAuthUrl.mockRejectedValueOnce(
          new Error("Provider unavailable"),
        );

        const res = await request(app)
          .get("/api/auth/url/oauth")
          .query({ provider: VALID_OAUTH_PROVIDER })
          .set("Accept", "application/json");

        expect(res.status).toBe(500);
      });
    });
  });

  // =========================================================================
  // POST /api/auth/oauth-register
  // =========================================================================

  describe("POST /api/auth/social-signup", () => {
    describe("success — first-time signup (no local user yet)", () => {
      it("returns 200 and provisions a new user", async () => {
        const email = faker.internet.email().toLowerCase();
        oauthProviderReturns({ email, firstName: "Ada", lastName: "Lovelace" });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("user");
      });

      it("persists the new user with the OAuth provider and admin role", async () => {
        const email = faker.internet.email().toLowerCase();
        oauthProviderReturns({ email, firstName: "Ada", lastName: "Lovelace" });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(created).not.toBeNull();
        expect(created?.oauth).toBe(SOCIAL_OAUTH_METHOD.GOOGLE);
        expect(created?.roles).toBe(USER_TYPE.ADMIN);
        expect(created?.name.first).toBe("Ada");
        expect(created?.name.last).toBe("Lovelace");
      });

      it("creates and links a company for the new admin user", async () => {
        const email = faker.internet.email().toLowerCase();
        oauthProviderReturns({ email });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(created?.companyRef).toBeDefined();

        const company = await Company.findById(created!.companyRef);
        expect(company).not.toBeNull();
        expect(company?.userRef?.toString()).toBe(created!._id.toString());
      });

      it("falls back to placeholder names when the provider omits them", async () => {
        const email = faker.internet.email().toLowerCase();
        oauthProviderReturns({
          email,
          firstName: undefined,
          lastName: undefined,
        });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(created?.name.first).toBe("USER");
        expect(created?.name.last).toBe("BYLDD");
      });

      it("syncs the local user id and provider back to the auth provider", async () => {
        const email = faker.internet.email().toLowerCase();
        const providerId = faker.string.uuid();
        oauthProviderReturns({ email, id: providerId });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const created = await User.findOne({ email });
        expect(mockAuthKitProvider.updateUser).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: providerId,
            externalId: created!._id.toString(),
            metadata: expect.objectContaining({
              OAuthProvider: VALID_OAUTH_PROVIDER,
            }),
          }),
        );
      });

      it("returns token in response body for mobile clients", async () => {
        oauthProviderReturns({ email: faker.internet.email().toLowerCase() });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json")
          .set("x-client-platform", "mobile");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty("token");
        expect(res.body.data).toHaveProperty("refreshToken");
      });
    });

    describe("success — returning user (local user already exists)", () => {
      it("returns 200 and logs the existing user in", async () => {
        const { user } = await createTestSession();
        oauthProviderReturns({ email: user.email, id: user.externalUserId });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("does not create a duplicate user record", async () => {
        const { user } = await createTestSession();
        oauthProviderReturns({ email: user.email, id: user.externalUserId });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(await User.countDocuments({ email: user.email })).toBe(1);
      });
    });

    describe("blocked accounts", () => {
      it("rejects a login for an INACTIVE account", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          status: STATUS.INACTIVE,
        });
        oauthProviderReturns({ email: user.email, id: user.externalUserId });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED);
      });

      it("rejects a login for a DELETED account", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          status: STATUS.DELETED,
        });
        oauthProviderReturns({ email: user.email, id: user.externalUserId });

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED);
      });

      it("does not touch the blocked user's record", async () => {
        const { user } = await createTestSession(USER_TYPE.ADMIN, {
          status: STATUS.INACTIVE,
        });
        oauthProviderReturns({ email: user.email, id: user.externalUserId });

        await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        const after = await User.findById(user._id);
        expect(after?.status).toBe(STATUS.INACTIVE);
        expect(mockAuthKitProvider.updateUser).not.toHaveBeenCalled();
      });
    });

    describe("validation errors", () => {
      it("returns 400 when code is missing", async () => {
        const { code: _c, ...payload } = buildOauthRegisterPayload() as any;

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(payload)
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when oauthProvider is missing", async () => {
        const res = await request(app)
          .post("/api/auth/social-signup")
          .send({ code: faker.string.alphanumeric(32) })
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when oauthProvider is not a valid enum value", async () => {
        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload({ oauthProvider: "FakeOAuth" }))
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("returns 400 when the request body is empty", async () => {
        const res = await request(app)
          .post("/api/auth/social-signup")
          .send({})
          .set("Accept", "application/json");

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe("server errors", () => {
      it("returns 500 when authenticateWithCode throws", async () => {
        mockAuthKitProvider.authenticateWithCode.mockRejectedValueOnce(
          new Error("OAuth exchange failed"),
        );

        const res = await request(app)
          .post("/api/auth/social-signup")
          .send(buildOauthRegisterPayload())
          .set("Accept", "application/json");

        expect(res.status).toBe(500);
      });
    });
  });
});
