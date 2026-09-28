import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { Products } from "@/db/models/products";
import { RefreshToken } from "@/db/models/refreshToken";
import { Subscription } from "@/db/models/subscription";
import { IUserDocument, User } from "@/db/models/user";
import { STATUS, USER_TYPE } from "@/enums";
import { jwtHelper } from "@/helpers/jwt";
import { USER_RESPONSE_MESSAGES } from "@/modules/users/utils/users.constant";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import {
  createAdminSession,
  createSuperAdminSession,
  ITestSession,
  seedProduct,
} from "@/tests/utils/auth";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelSubscription = vi.hoisted(() => vi.fn());

vi.mock("@/providers/payment", () => ({
  paymentGateway: { cancelSubscription },
}));

/**
 * DELETE /api/user/me – anonymise the signed-in user's own account
 *
 * Auth required : Yes
 * Success       : 200, status DELETED, name/email/phone anonymised
 * Failure       : 401 unauthenticated, 409 sole admin with other members,
 *                 403 super admin, 500 when Stripe/auth provider fails
 */

async function addMember(
  session: ITestSession,
  role: USER_TYPE,
  extras: Record<string, unknown> = {},
) {
  return User.create({
    email: faker.internet.email().toLowerCase(),
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    roles: role,
    status: STATUS.ACTIVE,
    companyRef: session.company._id,
    ...extras,
  });
}

function seedSubscription(
  session: ITestSession,
  overrides: Record<string, unknown> = {},
) {
  return Subscription.create({
    userRef: session.user._id,
    companyRef: session.company._id,
    price: 10,
    currentPeriodStarts: Date.now(),
    currentPeriodEnds: Date.now() + 30 * 24 * 60 * 60 * 1000,
    stripeSubscriptionId: `sub_${faker.string.alphanumeric(14)}`,
    status: STATUS.ACTIVE,
    ...overrides,
  });
}

describe("DELETE /api/user/me", () => {
  const app = createApp();

  const deleteMe = (session: ITestSession) =>
    request(app)
      .delete("/api/user/me")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

  beforeEach(() => {
    cancelSubscription.mockResolvedValue({});
    mockAuthKitProvider.deleteUser.mockResolvedValue(undefined);
    mockAuthKitProvider.deleteOrganizationMembership.mockResolvedValue(
      undefined,
    );
  });

  describe("success", () => {
    it("anonymises the user and marks them DELETED", async () => {
      const session = await createAdminSession();
      await User.updateOne(
        { _id: session.user._id },
        { phone: "+15555550100", organizationMembershipId: "om_123" },
      );
      const originalEmail = session.user.email;

      const res = await deleteMe(session);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe(USER_RESPONSE_MESSAGES.ACCOUNT_DELETED);

      const user = await User.findById(session.user._id).lean();
      expect(user?.status).toBe(STATUS.DELETED);
      expect(user?.email).not.toBe(originalEmail);
      expect(user?.email).toBe(`deleted-${session.user._id}@deleted.invalid`);
      expect(user?.name).toEqual({ first: "Deleted", last: "User" });
      expect(user?.phone).toBe(`deleted-${session.user._id}`);
      expect(user?.externalUserId).toBeUndefined();
      expect(user?.organizationMembershipId).toBeUndefined();

      expect(mockAuthKitProvider.deleteOrganizationMembership).toBeCalledWith(
        "om_123",
      );
      expect(mockAuthKitProvider.deleteUser).toBeCalledWith(
        session.user.externalUserId,
      );
    });

    it("revokes refresh tokens and rejects the old session afterwards", async () => {
      const session = await createAdminSession();
      await RefreshToken.create({
        userId: session.user._id,
        token: faker.string.uuid(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await deleteMe(session);

      expect(
        await RefreshToken.countDocuments({ userId: session.user._id }),
      ).toBe(0);
      const res = await request(app)
        .get("/api/user/me")
        .set("Cookie", session.cookie);
      expect(res.status).toBe(401);
    });

    it("keeps the products the user created", async () => {
      const session = await createAdminSession();
      const product = await seedProduct(session.company._id, {
        userRef: session.user._id,
      });

      await deleteMe(session);

      const kept = await Products.findById(product._id);
      expect(kept).not.toBeNull();
      expect(kept?.status).not.toBe(STATUS.DELETED);
    });

    it("cancels the user's active subscription at period end", async () => {
      const session = await createAdminSession();
      const subscription = await seedSubscription(session);

      await deleteMe(session);

      expect(cancelSubscription).toBeCalledTimes(1);
      expect(cancelSubscription).toBeCalledWith(
        subscription.stripeSubscriptionId,
      );
      const updated = await Subscription.findById(subscription._id);
      expect(updated?.subscriptionCancellationRequested).toBe(true);
    });

    it("does not re-cancel an already cancelled subscription", async () => {
      const session = await createAdminSession();
      await seedSubscription(session, {
        subscriptionCancellationRequested: true,
      });

      await deleteMe(session);

      expect(cancelSubscription).not.toBeCalled();
    });

    it("marks the company DELETED when the user was its last member", async () => {
      const session = await createAdminSession();

      await deleteMe(session);

      const company = await Company.findById(session.company._id);
      expect(company?.companyStatus).toBe(STATUS.DELETED);
    });

    it("lets a regular member delete and leaves the company active", async () => {
      const admin = await createAdminSession();
      const member = await addMember(admin, USER_TYPE.USER);

      const res = await deleteMe(sessionFor(member, admin));

      expect(res.status).toBe(200);
      const company = await Company.findById(admin.company._id);
      expect(company?.companyStatus).toBe(STATUS.ACTIVE);
    });

    it("lets an admin delete when another admin remains", async () => {
      const session = await createAdminSession();
      await addMember(session, USER_TYPE.ADMIN);
      await addMember(session, USER_TYPE.USER);

      const res = await deleteMe(session);

      expect(res.status).toBe(200);
    });

    it("allows the same email to register again", async () => {
      const session = await createAdminSession();
      const email = session.user.email;
      await deleteMe(session);

      mockAuthKitProvider.createUser.mockResolvedValue({
        id: faker.string.uuid(),
        email,
        firstName: "New",
        lastName: "Person",
        emailVerified: true,
        metadata: {},
      });
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: { first: "New", last: "Person" },
          email,
          password: "StrongPass@123",
        })
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      const active = await User.findOne({ email, status: STATUS.ACTIVE });
      expect(active).not.toBeNull();
      expect(active?._id.toString()).not.toBe(session.user._id.toString());
    });
  });

  describe("refusals", () => {
    it("returns 409 when the user is the only admin and others remain", async () => {
      const session = await createAdminSession();
      await addMember(session, USER_TYPE.USER);
      await seedSubscription(session);

      const res = await deleteMe(session);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        USER_RESPONSE_MESSAGES.SOLE_ADMIN_CANNOT_DELETE,
      );
      const user = await User.findById(session.user._id);
      expect(user?.status).toBe(STATUS.ACTIVE);
      expect(cancelSubscription).not.toBeCalled();
      expect(mockAuthKitProvider.deleteUser).not.toBeCalled();
    });

    it("ignores already-deleted members when checking for other members", async () => {
      const session = await createAdminSession();
      await addMember(session, USER_TYPE.USER, { status: STATUS.DELETED });

      const res = await deleteMe(session);

      expect(res.status).toBe(200);
    });

    it("returns 403 for a super admin", async () => {
      const session = await createSuperAdminSession();

      const res = await deleteMe(session);

      expect(res.status).toBe(403);
      const user = await User.findById(session.user._id);
      expect(user?.status).toBe(STATUS.ACTIVE);
    });

    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).delete("/api/user/me");

      expect(res.status).toBe(401);
    });
  });

  describe("external failures", () => {
    it("leaves the account intact when Stripe cancellation fails", async () => {
      const session = await createAdminSession();
      await seedSubscription(session);
      cancelSubscription.mockRejectedValue(new Error("stripe down"));

      const res = await deleteMe(session);

      expect(res.status).toBe(500);
      const user = await User.findById(session.user._id);
      expect(user?.status).toBe(STATUS.ACTIVE);
      expect(user?.email).toBe(session.user.email);
    });

    it("treats an already-deleted auth provider user as success", async () => {
      const session = await createAdminSession();
      mockAuthKitProvider.deleteUser.mockRejectedValue(
        new Error("User not found"),
      );

      const res = await deleteMe(session);

      expect(res.status).toBe(200);
    });
  });
});

function sessionFor(user: IUserDocument, admin: ITestSession): ITestSession {
  const token = jwtHelper.generateToken({
    _id: user._id.toString(),
    email: user.email,
    orgId: admin.company._id.toString(),
    permissions: [],
  });
  return {
    user,
    company: admin.company,
    token,
    cookie: `token=${token}`,
    bearerHeader: `Bearer ${token}`,
  };
}
