import { type ISubscription, Subscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { NOTIFICATION_TYPE, STATUS } from "@/enums";
import { getNotificationChannels } from "@/helpers/notification";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { sendSubscriptionRenewalReminderEmail } from "@/webhooks/subscription/subscription-email.helper";

/**
 * Per-subscription hook for the renewal-reminder job: emails the subscription's user once per billing period,
 * if their notification preferences allow email for SUBSCRIPTION_RENEWAL.
 */
export const sendSubscriptionRenewalReminder = async (
  subscription: ISubscription,
): Promise<void> => {
  const subscriptionId = String(subscription._id);

  if (
    subscription.renewalReminderSentForPeriodEnd ===
    subscription.currentPeriodEnds
  ) {
    return;
  }

  const user = await User.findById(subscription.userRef);
  if (!user || user.status !== STATUS.ACTIVE || !user.email) {
    console.log(
      `[subscription-renewal] skipping subscription ${subscriptionId}: user ${String(subscription.userRef)} is missing, inactive, or has no email`,
    );
    return;
  }

  const preferences = await notificationsHelper.getPreferences(user._id);
  if (
    !getNotificationChannels(
      preferences,
      NOTIFICATION_TYPE.SUBSCRIPTION_RENEWAL,
    ).email
  ) {
    return;
  }

  await sendSubscriptionRenewalReminderEmail({
    email: user.email,
    fullName: user.fullName,
    // Same fallback the subscription webhook stores when the Stripe plan has no nickname.
    planName: subscription.planName || "Unnamed Plan",
    renewsAt: subscription.currentPeriodEnds,
    amount: subscription.price,
  });

  // Marked only after a successful send, so a failed send is not recorded as sent and a same-day re-run can retry it.
  // Not atomic: two runs overlapping on the same subscription can both send; the job is daily and single-attempt.
  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        renewalReminderSentForPeriodEnd: subscription.currentPeriodEnds,
      },
    },
  );
};
