import { createApp } from "@/app";
import { Subscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import { paymentGateway } from "@/providers/payment";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { createAdminSession, ITestSession } from "@/tests/utils/auth";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PUT /api/admin/subscription/pause, PUT /api/admin/subscription/resume
 * and the pause/resume handling in POST /webhook/subscription.
 */

const PERIOD_START = 1_790_000_000;
const PERIOD_END = PERIOD_START + 30 * 24 * 60 * 60;

async function seedSubscription(
  session: ITestSession,
  overrides: Record<string, unknown> = {},
) {
  return Subscription.create({
    userRef: session.user._id,
    companyRef: session.company._id,
    price: 1000,
    planId: "price_basic",
    planName: "Basic",
    productId: "prod_basic",
    stripeSubscriptionId: "sub_123",
    stripeCustomerId: "cus_123",
    currentPeriodStarts: PERIOD_START,
    currentPeriodEnds: PERIOD_END,
    ...overrides,
  });
}

function subscriptionUpdatedEvent(
  object: Record<string, unknown>,
  previousAttributes: Record<string, unknown> = {},
) {
  return {
    type: "customer.subscription.updated",
    created: PERIOD_START + 100,
    data: {
      object: {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: false,
        plan: { amount: 1000, id: "price_basic", nickname: "Basic" },
        items: {
          data: [
            {
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
              plan: { product: "prod_basic", interval: "month" },
            },
          ],
        },
        pause_collection: null,
        ...object,
      },
      previous_attributes: previousAttributes,
    },
  };
}

describe("subscription pause / resume", () => {
  const app = createApp();
  let session: ITestSession;

  beforeEach(async () => {
    session = await createAdminSession();
    vi.spyOn(paymentGateway, "pauseSubscription").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(paymentGateway, "resumeSubscription").mockResolvedValue(
      {} as never,
    );
  });

  describe("PUT /api/admin/subscription/pause", () => {
    it("pauses billing in Stripe and records the pause, keeping access", async () => {
      await seedSubscription(session);
      const resumesAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const res = await request(app)
        .put("/api/admin/subscription/pause")
        .set("Cookie", session.cookie)
        .send({ resumesAt: resumesAt.toISOString() });

      expect(res.status).toBe(200);
      const expectedResumesAt = Math.floor(resumesAt.getTime() / 1000);
      expect(paymentGateway.pauseSubscription).toHaveBeenCalledWith(
        "sub_123",
        expectedResumesAt,
      );
      const saved = await Subscription.findOne({
        stripeSubscriptionId: "sub_123",
      });
      expect(saved!.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
      expect(saved!.pausedAt).toBeGreaterThan(0);
      expect(saved!.pauseResumesAt).toBe(expectedResumesAt);
    });

    it("pauses indefinitely when no resume date is given", async () => {
      await seedSubscription(session);

      const res = await request(app)
        .put("/api/admin/subscription/pause")
        .set("Cookie", session.cookie)
        .send({});

      expect(res.status).toBe(200);
      expect(paymentGateway.pauseSubscription).toHaveBeenCalledWith(
        "sub_123",
        undefined,
      );
    });

    it("rejects a resume date in the past", async () => {
      await seedSubscription(session);

      const res = await request(app)
        .put("/api/admin/subscription/pause")
        .set("Cookie", session.cookie)
        .send({ resumesAt: new Date(Date.now() - 60_000).toISOString() });

      expect(res.status).toBe(400);
      expect(paymentGateway.pauseSubscription).not.toHaveBeenCalled();
    });

    it("returns 404 without a current subscription", async () => {
      const res = await request(app)
        .put("/api/admin/subscription/pause")
        .set("Cookie", session.cookie)
        .send({});

      expect(res.status).toBe(404);
    });

    it("rejects pausing twice", async () => {
      await seedSubscription(session, { pausedAt: PERIOD_START + 10 });

      const res = await request(app)
        .put("/api/admin/subscription/pause")
        .set("Cookie", session.cookie)
        .send({});

      expect(res.status).toBe(400);
      expect(paymentGateway.pauseSubscription).not.toHaveBeenCalled();
    });

    it("rejects pausing a subscription already scheduled for cancellation", async () => {
      await seedSubscription(session, {
        subscriptionCancellationRequested: true,
      });

      const res = await request(app)
        .put("/api/admin/subscription/pause")
        .set("Cookie", session.cookie)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/admin/subscription/resume", () => {
    it("resumes billing and clears the pause", async () => {
      await seedSubscription(session, {
        status: STRIPE_SUBSCRIPTION_STATUS.PAUSED,
        pausedAt: PERIOD_START + 10,
        pauseResumesAt: PERIOD_END + 100,
      });

      const res = await request(app)
        .put("/api/admin/subscription/resume")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(paymentGateway.resumeSubscription).toHaveBeenCalledWith("sub_123");
      const saved = await Subscription.findOne({
        stripeSubscriptionId: "sub_123",
      });
      expect(saved!.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
      expect(saved!.pausedAt).toBeNull();
      expect(saved!.pauseResumesAt).toBeNull();
    });

    it("rejects resuming a subscription that is not paused", async () => {
      await seedSubscription(session);

      const res = await request(app)
        .put("/api/admin/subscription/resume")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(400);
      expect(paymentGateway.resumeSubscription).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/admin/subscription/plans while paused", () => {
    it("asks the customer to resume before changing plans", async () => {
      await User.updateOne(
        { _id: session.user._id },
        { stripeCustomerId: "cus_123" },
      );
      session.user.stripeCustomerId = "cus_123";
      vi.spyOn(subscriptionHelper, "findUserPlans").mockResolvedValue({
        planId: "price_basic",
        stripeSubscriptionId: "sub_123",
        description: "",
        features: [],
        status: STRIPE_SUBSCRIPTION_STATUS.PAUSED,
        pausedAt: PERIOD_START + 10,
        pauseResumesAt: null,
      });
      const update = vi.spyOn(paymentGateway, "updateSubscription");

      const res = await request(app)
        .post("/api/admin/subscription/plans")
        .set("Cookie", session.cookie)
        .send({ newPriceId: "price_pro" });

      expect(res.status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("POST /webhook/subscription", () => {
    const sendWebhook = async (event: unknown) => {
      vi.spyOn(paymentGateway, "verifyWebhookEvent").mockResolvedValue(
        event as never,
      );
      return request(app)
        .post("/webhook/subscription")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "test")
        .send("{}");
    };

    beforeEach(async () => {
      await User.updateOne(
        { _id: session.user._id },
        { stripeCustomerId: "cus_123" },
      );
    });

    it("keeps access during the paid period and sends no new-subscription email", async () => {
      await seedSubscription(session, { pausedAt: PERIOD_START + 50 });

      const res = await sendWebhook(
        subscriptionUpdatedEvent(
          { pause_collection: { behavior: "void", resumes_at: null } },
          { pause_collection: null },
        ),
      );

      expect(res.status).toBe(200);
      const saved = await Subscription.findOne({
        stripeSubscriptionId: "sub_123",
      });
      expect(saved!.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
      expect(saved!.pausedAt).toBe(PERIOD_START + 50);
      expect(mockEmailService.sendTemplateEmail).not.toHaveBeenCalled();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it("marks the subscription PAUSED once the paid period ends", async () => {
      await seedSubscription(session, { pausedAt: PERIOD_START + 50 });

      await sendWebhook(
        subscriptionUpdatedEvent({
          pause_collection: { behavior: "void", resumes_at: null },
          items: {
            data: [
              {
                current_period_start: PERIOD_END,
                current_period_end: PERIOD_END + 30 * 24 * 60 * 60,
                plan: { product: "prod_basic", interval: "month" },
              },
            ],
          },
        }),
      );

      const saved = await Subscription.findOne({
        stripeSubscriptionId: "sub_123",
      });
      expect(saved!.status).toBe(STRIPE_SUBSCRIPTION_STATUS.PAUSED);
      expect(saved!.currentPeriodStarts).toBe(PERIOD_END);
    });

    it("reactivates on resume even when the resume endpoint already cleared pausedAt", async () => {
      await seedSubscription(session);

      await sendWebhook(
        subscriptionUpdatedEvent(
          {},
          { pause_collection: { behavior: "void", resumes_at: null } },
        ),
      );

      const saved = await Subscription.findOne({
        stripeSubscriptionId: "sub_123",
      });
      expect(saved!.status).toBe(STRIPE_SUBSCRIPTION_STATUS.ACTIVE);
      expect(saved!.pausedAt).toBeNull();
      expect(mockEmailService.sendTemplateEmail).not.toHaveBeenCalled();
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
