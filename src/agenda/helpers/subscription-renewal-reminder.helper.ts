import type { ISubscription } from "@/db/models/subscription";

// Per-subscription hook for the renewal-reminder job. Logs only for now; the reminder email plugs in here.
export const sendSubscriptionRenewalReminder = async (
  subscription: ISubscription,
): Promise<void> => {
  console.log(
    `[subscription-renewal] reminder due for subscription ${String(subscription._id)} (user ${String(subscription.userRef)}), renews at ${new Date(subscription.currentPeriodEnds * 1000).toISOString()}`,
  );
};
