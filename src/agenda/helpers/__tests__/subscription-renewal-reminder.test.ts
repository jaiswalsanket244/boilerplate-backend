import { describe, expect, it } from "vitest";

import {
  RENEWAL_REMINDER_DAYS_BEFORE,
  sendSubscriptionRenewalReminders,
} from "@/agenda/helpers/subscription-renewal-reminder.helper";
import { Subscription } from "@/db/models/subscription";
import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { NOTIFICATION_TYPE, STATUS } from "@/enums";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { createUserSession } from "@/tests/utils/auth";

const NOW = new Date("2026-09-30T09:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const DAY = 24 * 60 * 60;

async function seedSubscription(overrides: Record<string, unknown> = {}) {
  const { user, company } = await createUserSession();
  const subscription = await Subscription.create({
    userRef: user._id,
    companyRef: company._id,
    planName: "Pro",
    price: 1999,
    period: "month",
    currentPeriodStarts: NOW_SECONDS - 27 * DAY,
    currentPeriodEnds: NOW_SECONDS + 2 * DAY,
    status: STATUS.ACTIVE,
    ...overrides,
  });
  return { user, subscription };
}

const sentTo = () =>
  mockEmailService.sendEmail.mock.calls.map(([email]) => email.to);

const markerOf = async (id: unknown) =>
  (await Subscription.findById(id).lean())?.renewalReminderSentForPeriodEnd;

describe("sendSubscriptionRenewalReminders", () => {
  it("sends for a subscription renewing inside the window and records the period", async () => {
    const { user, subscription } = await seedSubscription();

    await sendSubscriptionRenewalReminders(NOW);

    expect(sentTo()).toEqual([user.email]);
    expect(await markerOf(subscription._id)).toBe(
      subscription.currentPeriodEnds,
    );
  });

  it("includes the window edge and excludes anything past it or already ended", async () => {
    const edge = await seedSubscription({
      currentPeriodEnds: NOW_SECONDS + RENEWAL_REMINDER_DAYS_BEFORE * DAY,
    });
    const fourDays = await seedSubscription({
      currentPeriodEnds: NOW_SECONDS + 4 * DAY,
    });
    const justPastEdge = await seedSubscription({
      currentPeriodEnds: NOW_SECONDS + RENEWAL_REMINDER_DAYS_BEFORE * DAY + 1,
    });
    const past = await seedSubscription({
      currentPeriodEnds: NOW_SECONDS - DAY,
    });
    const endsNow = await seedSubscription({ currentPeriodEnds: NOW_SECONDS });

    await sendSubscriptionRenewalReminders(NOW);

    expect(sentTo()).toEqual([edge.user.email]);
    for (const { subscription } of [fourDays, justPastEdge, past, endsNow]) {
      expect(await markerOf(subscription._id)).toBeUndefined();
    }
  });

  it.each([
    ["INACTIVE", { status: STATUS.INACTIVE }],
    ["PAST_DUE", { status: STATUS.PAST_DUE }],
    ["DELETED", { status: STATUS.DELETED }],
    ["cancellation requested", { subscriptionCancellationRequested: true }],
  ])("skips %s subscriptions", async (_label, overrides) => {
    const { subscription } = await seedSubscription(overrides);

    await sendSubscriptionRenewalReminders(NOW);

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(await markerOf(subscription._id)).toBeUndefined();
  });

  it("does not re-send on a second run the same day or later in the window", async () => {
    await seedSubscription();

    await sendSubscriptionRenewalReminders(NOW);
    await sendSubscriptionRenewalReminders(NOW);
    await sendSubscriptionRenewalReminders(
      new Date(NOW.getTime() + DAY * 1000),
    );

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends only once when two runs overlap", async () => {
    await seedSubscription();

    await Promise.all([
      sendSubscriptionRenewalReminders(NOW),
      sendSubscriptionRenewalReminders(NOW),
    ]);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends again once the subscription renews into a new period", async () => {
    const { subscription } = await seedSubscription();
    await sendSubscriptionRenewalReminders(NOW);

    const nextPeriodEnd = subscription.currentPeriodEnds + 30 * DAY;
    await Subscription.updateOne(
      { _id: subscription._id },
      {
        currentPeriodStarts: subscription.currentPeriodEnds,
        currentPeriodEnds: nextPeriodEnd,
      },
    );
    const nextRun = new Date((nextPeriodEnd - 2 * DAY) * 1000);
    await sendSubscriptionRenewalReminders(nextRun);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(2);
    expect(await markerOf(subscription._id)).toBe(nextPeriodEnd);
  });

  it("sends no email when billing email is off and does not re-evaluate", async () => {
    const { user, subscription } = await seedSubscription();
    await UserNotificationPreference.create({
      userRef: user._id,
      preferences: { [NOTIFICATION_TYPE.BILLING]: { email: false } },
    });

    await sendSubscriptionRenewalReminders(NOW);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    expect(await markerOf(subscription._id)).toBe(
      subscription.currentPeriodEnds,
    );

    // Turning the pref back on mid-window does not trigger a late reminder for this period.
    await UserNotificationPreference.updateOne(
      { userRef: user._id },
      { preferences: { [NOTIFICATION_TYPE.BILLING]: { email: true } } },
    );
    await sendSubscriptionRenewalReminders(NOW);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("clears the marker when sending throws, keeps processing others, and retries next run", async () => {
    const failing = await seedSubscription();
    const other = await seedSubscription();
    mockEmailService.sendEmail.mockImplementation(async ({ to }) => {
      if (to === failing.user.email) throw new Error("SES down");
    });

    await sendSubscriptionRenewalReminders(NOW);

    expect(sentTo()).toEqual(
      expect.arrayContaining([failing.user.email, other.user.email]),
    );
    expect(await markerOf(failing.subscription._id)).toBeUndefined();
    expect(await markerOf(other.subscription._id)).toBe(
      other.subscription.currentPeriodEnds,
    );

    mockEmailService.sendEmail.mockReset();
    await sendSubscriptionRenewalReminders(NOW);
    expect(sentTo()).toEqual([failing.user.email]);
  });
});
