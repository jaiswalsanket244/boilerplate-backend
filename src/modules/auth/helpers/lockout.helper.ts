import envConfig from "@/config/env";
import {
  LoginAttempt,
  type ILoginAttemptDocument,
} from "@/db/models/loginAttempt";
import { emitAccountLocked } from "@/modules/auth/helpers/auth-audit.helper";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";

/**
 * Login lockout helpers.
 *
 * The counter is threshold-based with no time decay — it only clears on a
 * successful login or password reset (see {@link clearFailedAttempts}). Each
 * helper is a no-op when the kill switch is off so the login flow behaves
 * exactly as it did before the feature.
 */

export interface ILockState {
  // Login should be refused right now.
  locked: boolean;
  // Terminal lock — only a password reset can clear it.
  resetRequired: boolean;
}

const UNLOCKED: ILockState = { locked: false, resetRequired: false };

function isLockoutEnabled(): boolean {
  return envConfig.LOGIN_LOCKOUT_ENABLED;
}

function ttlDate(from: Date): Date {
  return new Date(
    from.getTime() + LOGIN_LOCKOUT.TTL_DAYS * 24 * 60 * 60 * 1000,
  );
}

/**
 * The lock a given failure count trips, if any. Thresholds are hit exactly once
 * each because a locked account is refused before it can increment again.
 */
function lockForCount(
  count: number,
  now: Date,
): { lockedUntil: Date | null; resetRequired: boolean } | null {
  const { THRESHOLDS, LOCK_MINUTES } = LOGIN_LOCKOUT;

  if (count >= THRESHOLDS.TERMINAL) {
    return { lockedUntil: null, resetRequired: true };
  }
  if (count === THRESHOLDS.SECOND) {
    return {
      lockedUntil: new Date(now.getTime() + LOCK_MINUTES.SECOND * 60 * 1000),
      resetRequired: false,
    };
  }
  if (count === THRESHOLDS.FIRST) {
    return {
      lockedUntil: new Date(now.getTime() + LOCK_MINUTES.FIRST * 60 * 1000),
      resetRequired: false,
    };
  }
  return null;
}

/**
 * Atomically increment the failure counter, upserting the row on first failure.
 *
 * `$inc` is atomic so simultaneous failures never lose an increment once the row
 * exists. The only race is the initial insert: two concurrent upserts can both
 * try to create the row and one loses on the unique index (E11000). In that case
 * the row now exists, so a plain increment retry succeeds without losing a count.
 */
async function incrementAttempt(
  email: string,
  now: Date,
): Promise<ILoginAttemptDocument | null> {
  const update = {
    $inc: { failedCount: 1 },
    $set: { lastFailedAt: now, expiresAt: ttlDate(now) },
  };
  try {
    return await LoginAttempt.findOneAndUpdate({ email }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) {
      return LoginAttempt.findOneAndUpdate({ email }, update, { new: true });
    }
    throw err;
  }
}

/**
 * Read-only lock check. Runs before any user lookup / auth-provider call so a
 * locked account is refused without reaching WorkOS.
 */
export async function evaluateLockState(email: string): Promise<ILockState> {
  if (!isLockoutEnabled()) return UNLOCKED;

  const doc = await LoginAttempt.findOne({ email }).lean();
  if (!doc) return UNLOCKED;

  if (doc.resetRequired) return { locked: true, resetRequired: true };
  if (doc.lockedUntil && doc.lockedUntil > new Date()) {
    return { locked: true, resetRequired: false };
  }
  return UNLOCKED;
}

/**
 * Record one failed attempt and return the resulting lock state.
 *
 * The `$inc` is a single atomic upsert so concurrent failures can't lose an
 * increment. The returned post-increment count is unique per caller, so exactly
 * one caller observes each threshold and applies its lock.
 */
export async function recordFailedAttempt(email: string): Promise<ILockState> {
  if (!isLockoutEnabled()) return UNLOCKED;

  const now = new Date();
  const doc = await incrementAttempt(email, now);
  if (!doc) return UNLOCKED;

  const lock = lockForCount(doc.failedCount, now);

  if (!lock) {
    // Already inside an earlier lock window (e.g. resetRequired) — surface it.
    if (doc.resetRequired) return { locked: true, resetRequired: true };
    if (doc.lockedUntil && doc.lockedUntil > now) {
      return { locked: true, resetRequired: false };
    }
    return UNLOCKED;
  }

  // A terminal lock must be cleared by the reset flow only, so push its TTL far
  // out of reach — the row must not be garbage-collected while the lock stands.
  const lockUpdate: Record<string, unknown> = {
    lockedUntil: lock.lockedUntil,
    resetRequired: lock.resetRequired,
  };
  if (lock.resetRequired) {
    lockUpdate.expiresAt = new Date(
      now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000,
    );
  }

  await LoginAttempt.updateOne({ email }, { $set: lockUpdate });

  emitAccountLocked(
    email,
    lock.resetRequired ? "Account locked — reset required" : "Account locked",
  );

  return { locked: true, resetRequired: lock.resetRequired };
}

/**
 * Clear the counter and any lock. Called on a successful login and after a
 * successful password reset — the only ways a terminal lock is released.
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  if (!isLockoutEnabled()) return;
  await LoginAttempt.deleteOne({ email });
}
