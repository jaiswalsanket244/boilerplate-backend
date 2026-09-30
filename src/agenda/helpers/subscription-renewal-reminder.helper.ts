import { Subscription } from "@/db/models/subscription";
import { STATUS } from "@/enums";
import { sendSubscriptionRenewalReminderEmail } from "@/webhooks/subscription/subscription-email.helper";

export const RENEWAL_REMINDER_DAYS_BEFORE = 3;

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Sends one renewal reminder per billing period to active, non-cancelling subscriptions
 * renewing within RENEWAL_REMINDER_DAYS_BEFORE days (runs as a scheduled job).
 */
export const sendSubscriptionRenewalReminders = async (
  now: Date = new Date(),
): Promise<void> => {
  // currentPeriodEnds is Unix seconds. A window (not an exact-day match) lets a missed run catch up the next day.
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const windowEndSeconds =
    nowSeconds + RENEWAL_REMINDER_DAYS_BEFORE * SECONDS_PER_DAY;

  const cursor = Subscription.find({
    status: STATUS.ACTIVE,
    subscriptionCancellationRequested: { $ne: true },
    currentPeriodEnds: { $gt: nowSeconds, $lte: windowEndSeconds },
    $expr: {
      $ne: ["$renewalReminderSentForPeriodEnd", "$currentPeriodEnds"],
    },
  })
    .select("userRef planName price period currentPeriodEnds")
    .lean()
    .cursor();

  for await (const subscription of cursor) {
    const periodEnd = subscription.currentPeriodEnds;

    // Claim before sending: the conditional update is atomic, so overlapping runs can't both send.
    const claimed = await Subscription.findOneAndUpdate(
      {
        _id: subscription._id,
        currentPeriodEnds: periodEnd,
        renewalReminderSentForPeriodEnd: { $ne: periodEnd },
      },
      { $set: { renewalReminderSentForPeriodEnd: periodEnd } },
    );
    if (!claimed) continue;

    // A false return (billing email off / no email) keeps the marker so it isn't re-evaluated daily.
    try {
      await sendSubscriptionRenewalReminderEmail(subscription);
    } catch (error) {
      // Release the claim so the next daily run retries while still inside the window;
      // one failure must not stop the rest of the batch.
      console.error(
        `[subscription-renewal-reminders] failed for subscription ${String(subscription._id)}:`,
        error,
      );
      await Subscription.updateOne(
        { _id: subscription._id, renewalReminderSentForPeriodEnd: periodEnd },
        { $unset: { renewalReminderSentForPeriodEnd: 1 } },
      ).catch((unsetError: unknown) => {
        // Swallowed so the batch continues; the reminder is skipped for this period.
        console.error(
          `[subscription-renewal-reminders] failed to release claim for subscription ${String(subscription._id)}:`,
          unsetError,
        );
      });
    }
  }
};
