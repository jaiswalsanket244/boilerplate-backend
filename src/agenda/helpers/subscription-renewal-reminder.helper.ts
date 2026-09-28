import {
  Subscription,
  type ISubscriptionDocument,
} from "@/db/models/subscription";
import { STATUS } from "@/enums";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

// Remind customers this many whole UTC days before their subscription renews
export const RENEWAL_REMINDER_DAYS_BEFORE = 3;

/**
 * Returns the subscriptions that renew on the UTC calendar day exactly
 * RENEWAL_REMINDER_DAYS_BEFORE days after `now`.
 */
export const findSubscriptionsDueForRenewalReminder = async (
  now: Date = new Date(),
): Promise<ISubscriptionDocument[]> => {
  const targetDayStart = dayjs(now)
    .utc()
    .startOf("day")
    .add(RENEWAL_REMINDER_DAYS_BEFORE, "day");
  const targetDayEnd = targetDayStart.add(1, "day");

  // Matching exactly one target day per daily run means each subscription is
  // picked once per billing period without storing a "reminder sent" marker.
  // currentPeriodEnds is Stripe Unix seconds, hence .unix() rather than ms.
  return Subscription.find({
    status: STATUS.ACTIVE,
    subscriptionCancellationRequested: { $ne: true },
    stripeSubscriptionId: { $exists: true, $nin: [null, ""] },
    currentPeriodEnds: {
      $gte: targetDayStart.unix(),
      $lt: targetDayEnd.unix(),
    },
  });
};

/**
 * Sends the renewal reminder for one subscription.
 */
export const sendRenewalReminder = async (
  _subscription: ISubscriptionDocument,
): Promise<void> => {
  // TODO(CYR-163): send the reminder email per the user's notification preferences.
};

/**
 * Sends renewal reminders for every subscription due one (runs as a scheduled job).
 * @returns {Promise<void>}
 */
export const sendSubscriptionRenewalReminders = async (
  now: Date = new Date(),
  sendReminder: (
    subscription: ISubscriptionDocument,
  ) => Promise<void> = sendRenewalReminder,
): Promise<void> => {
  const subscriptions = await findSubscriptionsDueForRenewalReminder(now);

  for (const subscription of subscriptions) {
    try {
      await sendReminder(subscription);
    } catch (error) {
      // Log and continue so one failing subscription does not block the rest;
      // the job is single-attempt, so this reminder is skipped for this period.
      console.error(
        `[subscription-renewal-reminder] failed for subscription ${subscription._id}:`,
        error,
      );
    }
  }
};
