import { createApp } from "@/app";
import { Company } from "@/db/models/company";
import { Subscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { STATUS } from "@/enums";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import { paymentGateway } from "@/providers/payment";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import {
  createAdminSession,
  createSuperAdminSession,
} from "@/tests/utils/auth";
import { SubscriptionWebhook } from "@/webhooks/subscription/subscription.webhook";
import { Request, Response } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seedSubscription = (
  companyRef: mongoose.Types.ObjectId,
  userRef: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {},
) =>
  Subscription.create({
    companyRef,
    userRef,
    price: 1000,
    currentPeriodStarts: 1,
    currentPeriodEnds: 2,
    stripeSubscriptionId: `sub_${new mongoose.Types.ObjectId()}`,
    status: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
    ...overrides,
  });

describe("company deactivation subscription handling", () => {
  let cancelSpy: ReturnType<typeof vi.spyOn>;
  let undoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cancelSpy = vi
      .spyOn(paymentGateway, "cancelSubscription")
      .mockResolvedValue({} as never);
    undoSpy = vi
      .spyOn(paymentGateway, "undoCancelSubscription")
      .mockResolvedValue({} as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("PUT /api/super-admin/company/:id", () => {
    const app = createApp();

    const editCompany = async (
      companyId: mongoose.Types.ObjectId,
      body: Record<string, unknown>,
    ) => {
      const superAdmin = await createSuperAdminSession();
      return request(app)
        .put(`/api/super-admin/company/${companyId}`)
        .set("Cookie", superAdmin.cookie)
        .set("Accept", "application/json")
        .send(body);
    };

    it("cancels at period end exactly once on ACTIVE -> INACTIVE", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id);

      const first = await editCompany(company._id, {
        companyStatus: STATUS.INACTIVE,
      });
      const second = await editCompany(company._id, {
        companyStatus: STATUS.INACTIVE,
      });

      expect(first.status).toBe(200);
      expect(first.body.data.companyStatus).toBe(STATUS.INACTIVE);
      expect(second.status).toBe(200);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(cancelSpy).toHaveBeenCalledWith(subscription.stripeSubscriptionId);
      const after = await Subscription.findById(subscription._id);
      expect(after?.subscriptionCancellationRequested).toBe(true);
      expect(after?.cancelledByCompanyDeactivation).toBe(true);
      expect(after?.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
    });

    it("undoes the pending cancel on INACTIVE -> ACTIVE", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id);

      await editCompany(company._id, { companyStatus: STATUS.INACTIVE });
      const res = await editCompany(company._id, {
        companyStatus: STATUS.ACTIVE,
      });

      expect(res.status).toBe(200);
      expect(undoSpy).toHaveBeenCalledTimes(1);
      expect(undoSpy).toHaveBeenCalledWith(subscription.stripeSubscriptionId);
      const after = await Subscription.findById(subscription._id);
      expect(after?.subscriptionCancellationRequested).toBe(false);
      expect(after?.cancelledByCompanyDeactivation).toBe(false);
    });

    it("leaves subscriptions untouched when companyStatus does not change", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id);

      const res = await editCompany(company._id, { name: "Renamed" });
      await editCompany(company._id, { companyStatus: STATUS.ACTIVE });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Renamed");
      expect(cancelSpy).not.toHaveBeenCalled();
      expect(undoSpy).not.toHaveBeenCalled();
      const after = await Subscription.findById(subscription._id);
      expect(after?.subscriptionCancellationRequested).toBe(false);
    });

    it("still deactivates the company when Stripe fails", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id);
      cancelSpy.mockRejectedValue(new Error("Stripe down"));

      const res = await editCompany(company._id, {
        companyStatus: STATUS.INACTIVE,
      });

      expect(res.status).toBe(200);
      expect((await Company.findById(company._id))?.companyStatus).toBe(
        STATUS.INACTIVE,
      );
      expect(
        (await Subscription.findById(subscription._id))
          ?.subscriptionCancellationRequested,
      ).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("subscriptionHelper.cancelCompanySubscriptionsAtPeriodEnd", () => {
    it("cancels every billable subscription of the company", async () => {
      const { company, user } = await createAdminSession();
      const active = await seedSubscription(company._id, user._id);
      const pastDue = await seedSubscription(company._id, user._id, {
        status: STRIPE_SUBSCRIPTION_STATUS.PAST_DUE,
      });
      await seedSubscription(company._id, user._id, {
        status: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
      });

      await subscriptionHelper.cancelCompanySubscriptionsAtPeriodEnd(
        company._id,
      );

      expect(cancelSpy.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(
        [active.stripeSubscriptionId, pastDue.stripeSubscriptionId].sort(),
      );
    });

    it("skips a subscription the customer already cancelled and leaves it unflagged", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id, {
        subscriptionCancellationRequested: true,
      });

      await subscriptionHelper.cancelCompanySubscriptionsAtPeriodEnd(
        company._id,
      );

      expect(cancelSpy).not.toHaveBeenCalled();
      const after = await Subscription.findById(subscription._id);
      expect(after?.cancelledByCompanyDeactivation).toBe(false);
    });

    it("keeps cancelling the remaining subscriptions after one Stripe failure", async () => {
      const { company, user } = await createAdminSession();
      await seedSubscription(company._id, user._id);
      await seedSubscription(company._id, user._id);
      cancelSpy
        .mockRejectedValueOnce(new Error("Stripe down"))
        .mockResolvedValueOnce({} as never);

      await subscriptionHelper.cancelCompanySubscriptionsAtPeriodEnd(
        company._id,
      );

      expect(cancelSpy).toHaveBeenCalledTimes(2);
      expect(
        await Subscription.countDocuments({
          companyRef: company._id,
          cancelledByCompanyDeactivation: true,
        }),
      ).toBe(1);
    });
  });

  describe("subscriptionHelper.undoCompanySubscriptionCancellations", () => {
    it("does not revive a cancellation the customer made", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id, {
        subscriptionCancellationRequested: true,
      });

      await subscriptionHelper.undoCompanySubscriptionCancellations(
        company._id,
      );

      expect(undoSpy).not.toHaveBeenCalled();
      expect(
        (await Subscription.findById(subscription._id))
          ?.subscriptionCancellationRequested,
      ).toBe(true);
    });

    it("does nothing when the paid period already ended", async () => {
      const { company, user } = await createAdminSession();
      await seedSubscription(company._id, user._id, {
        status: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
        subscriptionCancellationRequested: true,
        cancelledByCompanyDeactivation: true,
      });

      await subscriptionHelper.undoCompanySubscriptionCancellations(
        company._id,
      );

      expect(undoSpy).not.toHaveBeenCalled();
    });

    it("keeps the local flags when Stripe rejects the undo", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id, {
        subscriptionCancellationRequested: true,
        cancelledByCompanyDeactivation: true,
      });
      undoSpy.mockRejectedValue(new Error("No such subscription"));

      await expect(
        subscriptionHelper.undoCompanySubscriptionCancellations(company._id),
      ).resolves.toBeUndefined();

      const after = await Subscription.findById(subscription._id);
      expect(after?.subscriptionCancellationRequested).toBe(true);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("customer.subscription.updated webhook", () => {
    const runWebhook = async (event: unknown) => {
      vi.spyOn(paymentGateway, "verifyWebhookEvent").mockResolvedValue(
        event as never,
      );
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      } as unknown as Response;
      await new SubscriptionWebhook().handleWebhook(
        { body: "{}", headers: {} } as Request,
        res,
        vi.fn(),
      );
    };

    const activeUpdate = (
      customer: string,
      subscriptionId: string,
      previousAttributes: Record<string, unknown>,
    ) => ({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subscriptionId,
          customer,
          status: "active",
          cancel_at_period_end: false,
          plan: { amount: 1000, id: "price_1", nickname: "Pro" },
          items: { data: [] },
        },
        previous_attributes: previousAttributes,
      },
    });

    it("does not send the welcome email when a pending cancellation is undone", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id);
      await User.updateOne({ _id: user._id }, { stripeCustomerId: "cus_undo" });

      await runWebhook(
        activeUpdate("cus_undo", subscription.stripeSubscriptionId!, {
          cancel_at_period_end: true,
        }),
      );

      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it("still sends the welcome email for other active updates", async () => {
      const { company, user } = await createAdminSession();
      const subscription = await seedSubscription(company._id, user._id);
      await User.updateOne({ _id: user._id }, { stripeCustomerId: "cus_new" });

      await runWebhook(
        activeUpdate("cus_new", subscription.stripeSubscriptionId!, {
          status: "incomplete",
        }),
      );

      expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });
});
