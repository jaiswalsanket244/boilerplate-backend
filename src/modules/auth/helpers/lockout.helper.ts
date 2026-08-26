import { LoginAttempt } from "@/db/models/loginAttempt";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";

/**
 * Lockout state machine for per-account password-guessing protection.
 *
 * Failed attempts are counted per email. Crossing a threshold (5 / 10 / 15)
 * locks the account for a growing duration; the 15th failure is terminal and
 * clears only via the password-reset flow. There is no time-based decay of the
 * counter — it resets only on a successful login or password reset.
 */

export type TLockState =
  { locked: false } | { locked: true; resetRequired: boolean };

export type TRecordOutcome = {
  failedCount: number;
  justLocked: boolean;
  resetRequired: boolean;
};

function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

/**
 * Given the current cumulative failure count, return the lock to apply, or null
 * if this count is not a trigger point. Triggers fire at exactly 5 and 10; 15+
 * is terminal (>= so a concurrent overshoot past 15 still terminal-locks).
 */
function computeLock(
  failedCount: number,
  now: Date,
): { lockedUntil: Date | null; resetRequired: boolean } | null {
  const { THRESHOLDS, DURATIONS_MS } = LOGIN_LOCKOUT;

  if (failedCount >= THRESHOLDS.TERMINAL) {
    return { lockedUntil: null, resetRequired: true };
  }
  if (failedCount === THRESHOLDS.EXTENDED) {
    return {
      lockedUntil: new Date(now.getTime() + DURATIONS_MS.EXTENDED),
      resetRequired: false,
    };
  }
  if (failedCount === THRESHOLDS.TEMPORARY) {
    return {
      lockedUntil: new Date(now.getTime() + DURATIONS_MS.TEMPORARY),
      resetRequired: false,
    };
  }
  return null;
}

export async function evaluateLockState(
  email: string,
  now: Date = new Date(),
): Promise<TLockState> {
  const record = await LoginAttempt.findOne({
    email: normalizeEmail(email),
  }).lean();

  if (!record) return { locked: false };

  if (record.resetRequired) return { locked: true, resetRequired: true };

  if (record.lockedUntil && record.lockedUntil.getTime() > now.getTime()) {
    return { locked: true, resetRequired: false };
  }

  return { locked: false };
}

async function incrementAttempt(key: string, now: Date) {
  return LoginAttempt.findOneAndUpdate(
    { email: key },
    {
      $inc: { failedCount: 1 },
      $set: {
        lastFailedAt: now,
        expiresAt: new Date(now.getTime() + LOGIN_LOCKOUT.ATTEMPT_TTL_MS),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/**
 * Atomically records one failed attempt and applies a lock if a threshold is
 * crossed. The $inc/upsert is atomic per document so concurrent failures never
 * lose an increment.
 */
export async function recordFailedAttempt(
  email: string,
  now: Date = new Date(),
): Promise<TRecordOutcome> {
  const key = normalizeEmail(email);

  let record;
  try {
    record = await incrementAttempt(key, now);
  } catch (error) {
    // Two concurrent upserts can both attempt the initial insert; the loser
    // hits a duplicate-key error (E11000). The document now exists, so a single
    // retry falls through to a plain increment and no count is lost.
    if (!isDuplicateKeyError(error)) throw error;
    record = await incrementAttempt(key, now);
  }

  const failedCount = record.failedCount;
  const lock = computeLock(failedCount, now);

  if (!lock) {
    return {
      failedCount,
      justLocked: false,
      resetRequired: record.resetRequired,
    };
  }

  await LoginAttempt.updateOne(
    { email: key },
    lock.resetRequired
      ? { $set: { resetRequired: true, lockedUntil: null, expiresAt: null } }
      : { $set: { lockedUntil: lock.lockedUntil } },
  );

  return { failedCount, justLocked: true, resetRequired: lock.resetRequired };
}

export async function clearFailedAttempts(email: string): Promise<void> {
  await LoginAttempt.deleteOne({ email: normalizeEmail(email) });
}
