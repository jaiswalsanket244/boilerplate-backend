import { emailService } from "@/providers/email";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

type TSubscriptionEmailParams = {
  email: string;
  fullName: string;
};

type TSubscriptionRenewalReminderEmailParams = TSubscriptionEmailParams & {
  planName: string;
  // Unix seconds, as stored in Subscription.currentPeriodEnds.
  renewsAt: number;
  // Smallest currency unit, as stored in Subscription.price.
  amount: number;
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

export async function sendSubscriptionRenewalReminderEmail({
  email,
  fullName,
  planName,
  renewsAt,
  amount,
}: TSubscriptionRenewalReminderEmailParams) {
  // UTC, to match the UTC day the renewal-reminder job selects on.
  const renewalDate = dayjs.unix(renewsAt).utc().format("MMMM D, YYYY");
  // No currency symbol: Subscription does not store the Stripe plan's currency.
  const formattedAmount = (amount / 100).toFixed(2);

  return emailService.sendEmail({
    to: email,
    subject: `Your ${planName} subscription renews on ${renewalDate}`,
    text: `
          Hey ${fullName},
          Your ${planName} subscription will renew on ${renewalDate} and you will be charged ${formattedAmount}.
          If you do not want to renew, cancel your subscription before then.
          `,
  });
}
