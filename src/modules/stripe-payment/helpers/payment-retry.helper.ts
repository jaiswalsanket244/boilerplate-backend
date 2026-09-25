// Maximum number of times a failed Stripe charge is retried before giving up.
// The product spec requires 3 attempts; do not increase without product sign-off.
export const MAX_RETRIES = 3;

// Fixed delay between retry attempts (10 minutes in milliseconds).
export const RETRY_DELAY_MS = 10 * 60 * 1_000;

/**
 * Returns true when another retry attempt is still within the allowed limit.
 * Call this before scheduling the next retry job to avoid unbounded retries.
 */
export function canRetry(retryCount: number): boolean {
  return retryCount < MAX_RETRIES;
}
