import { type Agenda, type Job, backoffStrategies } from "agenda";
import { JOBS } from "@/agenda/utils/job-names.constant";
import { StripeConnectHelper } from "@/agenda/helpers/stripe-connect.helper";
import { deletePreviousMonthEntries } from "@/agenda/helpers/error-logs.helper";
import { sendPasswordRotationReminders } from "@/agenda/helpers/password-rotation.helper";
import { runAuditRetentionSweep } from "@/agenda/helpers/audit-retention.helper";
import {
  retryFailedInvoice,
  type TInvoiceRetryJobData,
} from "@/agenda/helpers/payment-retry.helper";

// Register every job definition. Call once, before agenda.start().
export function registerAllJobs(agenda: Agenda): void {
  // Single-attempt for now; per-transfer retry comes with the some additional refactor.
  agenda.define(JOBS.STRIPE.PROCESS_TRANSFERS, async () => {
    await StripeConnectHelper.processTransfers();
  });

  /*
  Card declines are handled inside the helper (next attempt or cancel); this
  backoff only covers transient Stripe/API errors. Safe to rerun: an invoice
  that is no longer open is skipped.
  */
  agenda.define(
    JOBS.STRIPE.RETRY_FAILED_INVOICE,
    async (job: Job<TInvoiceRetryJobData>) => {
      await retryFailedInvoice(job.attrs.data);
    },
    {
      backoff: backoffStrategies.exponential({ delay: 60_000, maxRetries: 3 }),
    },
  );

  // Idempotent (deleteMany by date), so safe to retry.
  agenda.define(
    JOBS.LOGS.CLEANUP_PREV_MONTH,
    async () => {
      await deletePreviousMonthEntries();
    },
    {
      backoff: backoffStrategies.exponential({ delay: 60_000, maxRetries: 3 }),
    },
  );

  // Single-attempt — sends email, so a retry would re-send.
  agenda.define(JOBS.SECURITY.PASSWORD_EXPIRY_REMINDERS, async () => {
    await sendPasswordRotationReminders();
  });

  // Idempotent (checkpoint-driven sweep), so safe to retry.
  agenda.define(
    JOBS.AUDIT.RETENTION_SWEEP,
    async () => {
      await runAuditRetentionSweep();
    },
    {
      backoff: backoffStrategies.exponential({ delay: 60_000, maxRetries: 3 }),
    },
  );
}
