import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { User } from "@/db/models/user";
import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { NOTIFICATION_TYPE } from "@/enums";
import { mockEmailService } from "@/tests/mocks/email-service.mock";
import { createUserSession } from "@/tests/utils/auth";
import {
  formatRenewalDate,
  sendSubscriptionRenewalReminderEmail,
} from "@/webhooks/subscription/subscription-email.helper";

// 2026-10-15T23:30:00Z — late in the UTC day to catch local-timezone drift.
const RENEWS_AT_SECONDS = 1792107000;

const buildSubscription = (userRef: mongoose.Types.ObjectId) => ({
  userRef,
  planName: "Pro",
  price: 1999,
  period: "month",
  currentPeriodEnds: RENEWS_AT_SECONDS,
});

describe("sendSubscriptionRenewalReminderEmail", () => {
  it("sends the reminder when prefs are missing", async () => {
    const { user } = await createUserSession();

    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(user._id),
    );

    expect(sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    const [email] = mockEmailService.sendEmail.mock.calls[0];
    expect(email.to).toBe(user.email);
    expect(email.subject).toBe("Your Pro plan renews on October 15, 2026");
    expect(email.text).toContain(`Hey ${user.name.first}`);
    expect(email.text).toContain("October 15, 2026");
    expect(email.text).toContain("Amount: $19.99 per month");
    expect(email.text).toContain("manage or cancel");
  });

  it("sends when billing email is enabled", async () => {
    const { user } = await createUserSession();
    await UserNotificationPreference.create({
      userRef: user._id,
      preferences: { [NOTIFICATION_TYPE.BILLING]: { email: true } },
    });

    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(user._id),
    );

    expect(sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sends when the prefs doc has no billing key", async () => {
    const { user } = await createUserSession();
    await UserNotificationPreference.create({
      userRef: user._id,
      preferences: {
        [NOTIFICATION_TYPE.CHAT_MESSAGE]: { email: false },
      },
    });

    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(user._id),
    );

    expect(sent).toBe(true);
    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("skips when billing email is disabled", async () => {
    const { user } = await createUserSession();
    await UserNotificationPreference.create({
      userRef: user._id,
      preferences: { [NOTIFICATION_TYPE.BILLING]: { email: false } },
    });

    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(user._id),
    );

    expect(sent).toBe(false);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("still sends when only other billing channels are disabled", async () => {
    const { user } = await createUserSession();
    await UserNotificationPreference.create({
      userRef: user._id,
      preferences: {
        [NOTIFICATION_TYPE.BILLING]: { email: true, push: false },
      },
    });

    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(user._id),
    );

    expect(sent).toBe(true);
  });

  it("returns false when the user does not exist", async () => {
    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(new mongoose.Types.ObjectId()),
    );

    expect(sent).toBe(false);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("returns false when the user has no email", async () => {
    const user = await User.create({ phone: "+15555550123" });

    const sent = await sendSubscriptionRenewalReminderEmail(
      buildSubscription(user._id),
    );

    expect(sent).toBe(false);
    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("omits the period and uses a generic label when plan details are missing", async () => {
    const { user } = await createUserSession();

    await sendSubscriptionRenewalReminderEmail({
      ...buildSubscription(user._id),
      planName: undefined,
      period: undefined,
    });

    const [email] = mockEmailService.sendEmail.mock.calls[0];
    expect(email.subject).toBe(
      "Your subscription renews on October 15, 2026",
    );
    expect(email.text).toContain("Amount: $19.99\n");
  });
});

describe("formatRenewalDate", () => {
  it("formats Unix seconds as a UTC calendar date", () => {
    expect(formatRenewalDate(RENEWS_AT_SECONDS)).toBe("October 15, 2026");
    expect(formatRenewalDate(0)).toBe("January 1, 1970");
  });
});
