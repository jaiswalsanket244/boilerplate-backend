import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { STATUS } from "@/enums";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { paymentGateway } from "@/providers/payment";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import {
  ITestSession,
  createAdminSession,
  createSuperAdminSession,
} from "@/tests/utils/auth";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Subscription side effects of these transitions are covered in
// company-deactivation-subscription.test.ts.
describe("PUT /api/super-admin/company/:id — deactivate / reactivate", () => {
  const app = createApp();

  beforeEach(() => {
    vi.spyOn(paymentGateway, "cancelSubscription").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(paymentGateway, "undoCancelSubscription").mockResolvedValue(
      {} as never,
    );
  });

  const setCompanyStatus = async (
    companyId: mongoose.Types.ObjectId,
    companyStatus: STATUS,
  ) => {
    const superAdmin = await createSuperAdminSession();
    return request(app)
      .put(`/api/super-admin/company/${companyId}`)
      .set("Cookie", superAdmin.cookie)
      .set("Accept", "application/json")
      .send({ companyStatus });
  };

  const login = (member: ITestSession) => {
    mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
      user: { id: member.user.externalUserId, email: member.user.email },
    });
    return request(app)
      .post("/api/auth/login")
      .set("Accept", "application/json")
      .send({
        email: member.user.email,
        password: "StrongPass@123",
        loginType: "password",
      });
  };

  const getMe = (member: ITestSession) =>
    request(app)
      .get("/api/user/me")
      .set("Cookie", member.cookie)
      .set("Accept", "application/json");

  describe("deactivation", () => {
    it("returns 200 and stores INACTIVE without touching other fields", async () => {
      const member = await createAdminSession();
      const before = await Company.findById(member.company._id).lean();

      const res = await setCompanyStatus(member.company._id, STATUS.INACTIVE);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.companyStatus).toBe(STATUS.INACTIVE);
      expect(res.body.data._id).toBe(member.company._id.toString());
      const after = await Company.findById(member.company._id).lean();
      expect(after?.companyStatus).toBe(STATUS.INACTIVE);
      expect(after?.name).toBe(before?.name);
      expect(after?.externalId).toBe(before?.externalId);
      expect(after?.userRef?.toString()).toBe(before?.userRef?.toString());
    });

    it("blocks a member from logging in", async () => {
      const member = await createAdminSession();
      expect((await login(member)).status).toBe(200);

      await setCompanyStatus(member.company._id, STATUS.INACTIVE);
      const res = await login(member);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED);
    });

    it("rejects a member's existing session and clears its cookie", async () => {
      const member = await createAdminSession();
      expect((await getMe(member)).status).toBe(200);

      await setCompanyStatus(member.company._id, STATUS.INACTIVE);
      const res = await getMe(member);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      const cookies = res.headers["set-cookie"] as unknown as string[];
      expect(cookies.some((c) => c.startsWith("token=;"))).toBe(true);
    });

    it("leaves members of other companies unaffected", async () => {
      const member = await createAdminSession();
      const outsider = await createAdminSession();

      await setCompanyStatus(member.company._id, STATUS.INACTIVE);

      expect(
        (await Company.findById(outsider.company._id))?.companyStatus,
      ).toBe(STATUS.ACTIVE);
      expect((await getMe(outsider)).status).toBe(200);
      expect((await login(outsider)).status).toBe(200);
    });
  });

  describe("reactivation", () => {
    it("returns 200, stores ACTIVE and restores login and session access", async () => {
      const member = await createAdminSession();
      await setCompanyStatus(member.company._id, STATUS.INACTIVE);

      const res = await setCompanyStatus(member.company._id, STATUS.ACTIVE);

      expect(res.status).toBe(200);
      expect(res.body.data.companyStatus).toBe(STATUS.ACTIVE);
      expect((await Company.findById(member.company._id))?.companyStatus).toBe(
        STATUS.ACTIVE,
      );
      expect((await login(member)).status).toBe(200);
      expect((await getMe(member)).status).toBe(200);
    });
  });

  describe("authorization", () => {
    it("rejects a company admin and leaves the company active", async () => {
      const admin = await createAdminSession();

      const res = await request(app)
        .put(`/api/super-admin/company/${admin.company._id}`)
        .set("Cookie", admin.cookie)
        .set("Accept", "application/json")
        .send({ companyStatus: STATUS.INACTIVE });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect((await Company.findById(admin.company._id))?.companyStatus).toBe(
        STATUS.ACTIVE,
      );
    });

    it("rejects an unauthenticated caller and leaves the company active", async () => {
      const { company } = await createAdminSession();

      const res = await request(app)
        .put(`/api/super-admin/company/${company._id}`)
        .set("Accept", "application/json")
        .send({ companyStatus: STATUS.INACTIVE });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect((await Company.findById(company._id))?.companyStatus).toBe(
        STATUS.ACTIVE,
      );
    });
  });
});
