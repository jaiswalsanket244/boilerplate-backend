import { ISubscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE } from "@/enums";
import { getNotificationChannels } from "@/helpers/notification";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { emailService } from "@/providers/email";

type TSubscriptionEmailParams = {
  email: string;
  fullName: string;
};

export async function sendSubscriptionCancelledEmail({
  email,
  fullName,
}: TSubscriptionEmailParams) {
  return emailService.sendEmail({
    to: email,
    subject: `${fullName}  Subscription cancelled!`,
    text: `
              Hey ${fullName},
              We have successfully cancelled you renewal .
              `,
  });
}

export async function sendNewSubscriptionEmail({
  email,
  fullName,
}: TSubscriptionEmailParams) {
  return emailService.sendEmail({
    to: email,
    subject: ` Welcome`,
    text: `
          Hey ${fullName},
          Thanks for joining.
          `,
  });
}

export async function sendSubscriptionRenewalFailedEmail({
  email,
  fullName,
}: TSubscriptionEmailParams) {
  return emailService.sendEmail({
    to: email,
    subject: `${fullName} Welcome`,
    text: `
          Hey ${fullName},
          We were not able to renew your subscription. Please manually renew it.
          `,
  });
}

type TRenewalReminderSubscription = Pick<
  ISubscription,
  "userRef" | "planName" | "price" | "period" | "currentPeriodEnds"
>;

// currentPeriodEnds is stored in Unix seconds; format in UTC so the date does not shift with server timezone.
export function formatRenewalDate(currentPeriodEndsSeconds: number) {
  return new Date(currentPeriodEndsSeconds * 1000).toLocaleDateString(
    "en-US",
    { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" },
  );
}

/**
 * Emails the subscription owner that their plan renews soon, unless they turned billing emails off.
 * Returns whether an email was sent.
 */
export async function sendSubscriptionRenewalReminderEmail(
  subscription: TRenewalReminderSubscription,
): Promise<boolean> {
  const user = await User.findById(subscription.userRef);
  if (!user?.email) return false;

  const preferences = await notificationsHelper.getPreferences(user._id);
  const channels = getNotificationChannels(
    preferences,
    NOTIFICATION_TYPE.BILLING,
  );
  if (!channels[NOTIFICATION_CHANNEL.EMAIL]) return false;

  const plan = subscription.planName
    ? `${subscription.planName} plan`
    : "subscription";
  const renewalDate = formatRenewalDate(subscription.currentPeriodEnds);
  // price is Stripe's plan.amount, i.e. the smallest currency unit (cents).
  const amount =
    typeof subscription.price === "number"
      ? `$${(subscription.price / 100).toFixed(2)}${
          subscription.period ? ` per ${subscription.period}` : ""
        }`
      : null;

  await emailService.sendEmail({
    to: user.email,
    subject: `Your ${plan} renews on ${renewalDate}`,
    text: `
          Hey ${user.name?.first ?? "there"},
          Your ${plan} will renew automatically on ${renewalDate}.${
            amount ? `\n          Amount: ${amount}` : ""
          }
          You can manage or cancel your subscription anytime from your account settings.
          `,
  });

  return true;
}
