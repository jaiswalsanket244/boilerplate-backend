/*
Single source of truth for job names, shared by producers and consumers so they can't drift.
Convention: "<domain>:<action>".
*/
export const JOBS = {
  STRIPE: {
    PROCESS_TRANSFERS: "stripe:process-transfers",
  },
  LOGS: {
    CLEANUP_PREV_MONTH: "logs:cleanup-prev-month",
  },
  SECURITY: {
    PASSWORD_EXPIRY_REMINDERS: "security:password-expiry-reminders",
  },
  AUDIT: {
    RETENTION_SWEEP: "audit:retention-sweep",
  },
  NOTIFICATIONS: {
    SEND_DAILY_DIGEST: "notifications:send-daily-digest",
    SEND_WEEKLY_DIGEST: "notifications:send-weekly-digest",
  },
} as const;
