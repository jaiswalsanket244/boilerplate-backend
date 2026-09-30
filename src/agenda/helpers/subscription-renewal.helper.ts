import { type ISubscription, Subscription } from "@/db/models/subscription";
import { STATUS } from "@/enums";
import { sendSubscriptionRenewalReminder } from "@/agenda/helpers/subscription-renewal-reminder.helper";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

// Remind this many whole UTC days before currentPeriodEnds.
export const RENEWAL_REMINDER_LEAD_DAYS = 7;

/**
 * Subscriptions that will renew on the UTC day `leadDays` from `now`.
 * currentPeriodEnds is Stripe's current_period_end, stored in unix seconds, so the window is in seconds too.
 */
export const findSubscriptionsDueForRenewal = async (
  now: Date = new Date(),
  leadDays: number = RENEWAL_REMINDER_LEAD_DAYS,
): Promise<ISubscription[]> => {
  const targetDayStart = dayjs.utc(now).startOf("day").add(leadDays, "day");
  const targetDayEnd = targetDayStart.add(1, "day");

  return Subscription.find({
    status: STATUS.ACTIVE,
    // Cancelled at period end: it will not renew, so there is nothing to remind about.
    subscriptionCancellationRequested: { $ne: true },
    stripeSubscriptionId: { $exists: true, $nin: [null, ""] },
    currentPeriodEnds: {
      $gte: targetDayStart.unix(),
      $lt: targetDayEnd.unix(),
    },
  }).lean<ISubscription[]>();
};

/**
 * Runs as the daily renewal-reminder job: hands each due subscription to the reminder hook.
 * One subscription failing is logged and skipped so the rest of the batch still goes out.
 */
export const sendSubscriptionRenewalReminders = async (
  now: Date = new Date(),
): Promise<void> => {
  const subscriptions = await findSubscriptionsDueForRenewal(now);

  for (const subscription of subscriptions) {
    try {
      await sendSubscriptionRenewalReminder(subscription);
    } catch (error) {
      console.error(
        `[subscription-renewal] reminder failed for subscription ${String(subscription._id)}:`,
        error,
      );
    }
  }
};
