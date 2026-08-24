import envConfig from "@/config/env";
import { LoginAttempt } from "@/db/models/loginAttempt";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";

/**
 * Result of inspecting or mutating an account's lockout state.
 */
export type TLockState = {
  locked: boolean;
  resetRequired: boolean;
  /** Seconds until a timed lock lifts. Absent for terminal locks. */
  retryAfterSeconds?: number;
  /** True only on the single transition that applied a new lock (for auditing). */
  justLocked?: boolean;
};

const UNLOCKED: TLockState = { locked: false, resetRequired: false };

/** Live read of the kill switch so tests can flip it without re-importing. */
export function isLoginLockoutEnabled(): boolean {
  return envConfig.LOGIN_LOCKOUT_ENABLED;
}

/** Emails are the collection key — normalise so lookups and upserts always agree. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function secondsUntil(when: Date): number {
  return Math.max(1, Math.ceil((when.getTime() - Date.now()) / 1000));
}

/**
 * Read-only check: is the account currently locked? Never mutates, so it is safe
 * to call before the user is even looked up.
 */
export async function evaluateLockState(email: string): Promise<TLockState> {
  const record = await LoginAttempt.findOne({ email: normalize(email) }).lean();
  if (!record) return UNLOCKED;

  if (record.resetRequired) {
    return { locked: true, resetRequired: true };
  }

  if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
    return {
      locked: true,
      resetRequired: false,
      retryAfterSeconds: secondsUntil(record.lockedUntil),
    };
  }

  return UNLOCKED;
}

/**
 * Atomically increments the failed-attempt counter and applies whatever lock the
 * new count warrants. The `$inc` + upsert is a single atomic operation, so
 * concurrent failures can never lose an increment.
 *
 * Timed locks fire exactly on the threshold counts (5, 10). Increments only ever
 * happen while the account is unlocked — a locked account short-circuits before
 * this runs — so the counter always lands on the thresholds precisely.
 */
export async function recordFailedAttempt(email: string): Promise<TLockState> {
  const key = normalize(email);

  const record = await LoginAttempt.findOneAndUpdate(
    { email: key },
    { $inc: { failedCount: 1 }, $setOnInsert: { email: key } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const count = record.failedCount;

  // Terminal lock — persists until the password-reset flow clears it. Leaving
  // expiresAt null keeps the TTL monitor from ever reclaiming it.
  if (count >= LOGIN_LOCKOUT.TERMINAL.at) {
    const alreadyTerminal = record.resetRequired;
    if (!alreadyTerminal) {
      await LoginAttempt.updateOne(
        { email: key },
        { $set: { resetRequired: true, lockedUntil: null, expiresAt: null } },
      );
    }
    return { locked: true, resetRequired: true, justLocked: !alreadyTerminal };
  }

  const lockMinutes =
    count === LOGIN_LOCKOUT.SECOND.at
      ? LOGIN_LOCKOUT.SECOND.lockMinutes
      : count === LOGIN_LOCKOUT.FIRST.at
        ? LOGIN_LOCKOUT.FIRST.lockMinutes
        : null;

  if (lockMinutes !== null) {
    const lockedUntil = minutesFromNow(lockMinutes);
    await LoginAttempt.updateOne(
      { email: key },
      {
        $set: {
          lockedUntil,
          expiresAt: minutesFromNow(LOGIN_LOCKOUT.RECORD_TTL_MINUTES),
        },
      },
    );
    return {
      locked: true,
      resetRequired: false,
      retryAfterSeconds: secondsUntil(lockedUntil),
      justLocked: true,
    };
  }

  // Below a threshold: keep the count, just refresh the housekeeping TTL.
  await LoginAttempt.updateOne(
    { email: key },
    { $set: { expiresAt: minutesFromNow(LOGIN_LOCKOUT.RECORD_TTL_MINUTES) } },
  );
  return UNLOCKED;
}

/**
 * Clears the counter and any lock (including a terminal lock). Called on a
 * successful login and on a successful password reset.
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  await LoginAttempt.deleteOne({ email: normalize(email) });
}
