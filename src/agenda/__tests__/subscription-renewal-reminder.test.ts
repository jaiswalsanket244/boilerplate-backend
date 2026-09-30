import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@/app";
import { sendSubscriptionRenewalReminder } from "@/agenda/helpers/subscription-renewal-reminder.helper";
import { type ISubscription, Subscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { NOTIFICATION_TYPE, STATUS } from "@/enums";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { createTestSession } from "@/tests/utils/auth";

const PERIOD_END = Math.floor(
  new Date("2026-10-07T12:00:00Z").getTime() / 1000,
);

async function createUser(overrides: Record<string, unknown> = {}) {
  return User.create({
    email: `renewal-${new mongoose.Types.ObjectId().toString()}@example.com`,
    name: { first: "Ada", last: "Lovelace" },
    status: STATUS.ACTIVE,
    ...overrides,
  });
}

async function createSubscription(
  userRef: mongoose.Types.ObjectId,
  overrides: Partial<ISubscription> = {},
) {
  const doc = await Subscription.create({
    userRef,
    companyRef: new mongoose.Types.ObjectId(),
    price: 1999,
    currentPeriodStarts: PERIOD_END - 30 * 24 * 60 * 60,
    currentPeriodEnds: PERIOD_END,
    status: STATUS.ACTIVE,
    stripeSubscriptionId: `sub_${new mongoose.Types.ObjectId().toString()}`,
    planName: "Pro Monthly",
    ...overrides,
  });
  return doc.toObject() as ISubscription;
}

async function setRenewalEmailPreference(
  userRef: mongoose.Types.ObjectId,
  email: boolean,
) {
  await UserNotificationPreference.create({
    userRef,
    preferences: {
      [NOTIFICATION_TYPE.SUBSCRIPTION_RENEWAL]: {
        email,
        push: true,
        inApp: true,
      },
    },
  });
}

async function markerOf(subscription: ISubscription) {
  const fresh = await Subscription.findById(subscription._id).lean();
  return fresh?.renewalReminderSentForPeriodEnd;
}

describe("sendSubscriptionRenewalReminder", () => {
  beforeEach(() => {
    mockEmailService.sendEmail.mockReset();
    mockEmailService.sendEmail.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("adds a user-toggleable subscription_renewal notification type", () => {
    expect(NOTIFICATION_TYPE.SUBSCRIPTION_RENEWAL).toBe("subscription_renewal");
  });

  it("emails the subscription's user when their preference allows email", async () => {
    const user = await createUser();
    await setRenewalEmailPreference(user._id, true);
    const subscription = await createSubscription(user._id);

    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendEmail.mock.calls[0][0].to).toBe(user.email);
    expect(await markerOf(subscription)).toBe(PERIOD_END);
  });

  it("sends nothing when email is disabled for subscription renewals", async () => {
    const user = await createUser();
    await setRenewalEmailPreference(user._id, false);
    const subscription = await createSubscription(user._id);

    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(await markerOf(subscription)).toBeUndefined();
  });

  it("emails a user with no preference document", async () => {
    const user = await createUser();
    const subscription = await createSubscription(user._id);

    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("emails a user whose preference document has no entry for this type", async () => {
    const user = await createUser();
    await UserNotificationPreference.create({
      userRef: user._id,
      preferences: {
        [NOTIFICATION_TYPE.CHAT_MESSAGE]: {
          email: false,
          push: true,
          inApp: true,
        },
      },
    });
    const subscription = await createSubscription(user._id);

    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("includes the plan name, renewal date, and amount in the email", async () => {
    const user = await createUser();
    const subscription = await createSubscription(user._id);

    await sendSubscriptionRenewalReminder(subscription);

    const { subject, text } = mockEmailService.sendEmail.mock.calls[0][0];
    expect(subject).toContain("Pro Monthly");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Pro Monthly");
    expect(text).toContain("October 7, 2026");
    expect(text).toContain("19.99");
  });

  it("skips a subscription already reminded for this billing period", async () => {
    const user = await createUser();
    const subscription = await createSubscription(user._id, {
      renewalReminderSentForPeriodEnd: PERIOD_END,
    });

    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("sends again once the marker is from an earlier billing period", async () => {
    const user = await createUser();
    const previousPeriodEnd = PERIOD_END - 30 * 24 * 60 * 60;
    const subscription = await createSubscription(user._id, {
      renewalReminderSentForPeriodEnd: previousPeriodEnd,
    });

    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(await markerOf(subscription)).toBe(PERIOD_END);
  });

  it("sends only once across two runs for the same period", async () => {
    const user = await createUser();
    const subscription = await createSubscription(user._id);

    await sendSubscriptionRenewalReminder(subscription);
    const reloaded = await Subscription.findById(subscription._id).lean();
    await sendSubscriptionRenewalReminder(reloaded as ISubscription);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not set the marker when the send fails", async () => {
    const user = await createUser();
    const subscription = await createSubscription(user._id);
    mockEmailService.sendEmail.mockRejectedValueOnce(new Error("SES down"));

    await expect(sendSubscriptionRenewalReminder(subscription)).rejects.toThrow(
      "SES down",
    );

    expect(await markerOf(subscription)).toBeUndefined();
  });

  it("skips a missing user without throwing", async () => {
    const subscription = await createSubscription(
      new mongoose.Types.ObjectId(),
    );

    await expect(
      sendSubscriptionRenewalReminder(subscription),
    ).resolves.toBeUndefined();

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("skips an inactive user without throwing", async () => {
    const user = await createUser({ status: STATUS.INACTIVE });
    const subscription = await createSubscription(user._id);

    await expect(
      sendSubscriptionRenewalReminder(subscription),
    ).resolves.toBeUndefined();

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("skips a phone-only user with no email without throwing", async () => {
    const user = await createUser({ email: undefined, phone: "+15550100" });
    const subscription = await createSubscription(user._id);

    await expect(
      sendSubscriptionRenewalReminder(subscription),
    ).resolves.toBeUndefined();

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(await markerOf(subscription)).toBeUndefined();
  });

  it("lets a user turn renewal emails off through the preferences API", async () => {
    const app = createApp();
    const session = await createTestSession();

    const res = await request(app)
      .put("/api/notification/preferences")
      .set("Cookie", session.cookie)
      .send({
        type: NOTIFICATION_TYPE.SUBSCRIPTION_RENEWAL,
        channels: { email: false },
      });
    expect(res.status).toBe(200);

    const subscription = await createSubscription(session.user._id);
    await sendSubscriptionRenewalReminder(subscription);

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("still rejects an unknown preference type", async () => {
    const app = createApp();
    const session = await createTestSession();

    const res = await request(app)
      .put("/api/notification/preferences")
      .set("Cookie", session.cookie)
      .send({ type: "not_a_type", channels: { email: false } });

    expect(res.status).toBe(400);
  });
});
