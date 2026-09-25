import Stripe from "stripe";
import { agendaService } from "@/agenda/agenda.service";
import { JOBS } from "@/agenda/utils/job-names.constant";
import { paymentGateway } from "@/providers/payment";

// A failed renewal charge is retried 3 times, 10 minutes apart, then the subscription is cancelled.
export const PAYMENT_RETRY = {
  MAX_RETRIES: 3,
  DELAY_MS: 10 * 60 * 1000,
} as const;

export type TInvoiceRetryJobData = {
  invoiceId: string;
  // 1-based retry number (the original failed charge is not counted).
  attempt: number;
};

/*
Keyed on (invoice, attempt) and insert-only: invoice.payment_failed is re-sent on
webhook redelivery and on every failed retry, and must neither duplicate an attempt
nor re-arm one that already ran.
*/
const scheduleRetry = async (invoiceId: string, attempt: number) => {
  await agendaService.scheduleUnique<TInvoiceRetryJobData>(
    new Date(Date.now() + PAYMENT_RETRY.DELAY_MS),
    JOBS.STRIPE.RETRY_FAILED_INVOICE,
    { invoiceId, attempt },
    { "data.invoiceId": invoiceId, "data.attempt": attempt },
  );
};

/*
Starts the retry cycle for a failed renewal invoice. Stripe's own retries are
turned off for this invoice only (Dashboard settings are left as-is) so they don't
stack on top of ours.
*/
export const startInvoiceRetries = async (invoiceId: string) => {
  await paymentGateway.disableInvoiceAutoAdvance(invoiceId);
  await scheduleRetry(invoiceId, 1);
};

/*
Agenda handler: re-charges the invoice once. On a decline, schedules the next
attempt, or cancels the subscription after the last one.
*/
export const retryFailedInvoice = async ({
  invoiceId,
  attempt,
}: TInvoiceRetryJobData) => {
  const invoice = await paymentGateway.retrieveInvoice(invoiceId);
  // Paid, voided or marked uncollectible since the failure: nothing left to retry.
  if (invoice.status !== "open") return;

  try {
    await paymentGateway.payInvoice(invoiceId);
    return;
  } catch (error) {
    /*
    Only a card decline uses up an attempt. Anything else (network, rate limit,
    API error) is rethrown so Agenda's backoff reruns this same attempt.
    */
    if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
  }

  if (attempt < PAYMENT_RETRY.MAX_RETRIES) {
    await scheduleRetry(invoiceId, attempt + 1);
    return;
  }

  // customer.subscription.deleted then clears the subscription in our DB.
  if (typeof invoice.subscription === "string") {
    await paymentGateway.cancelSubscriptionImmediately(invoice.subscription);
  }
};
