import envConfig from "@/config/env";
import { LoginAttempt } from "@/db/models/loginAttempt";
import { LOGIN_LOCKOUT } from "@/modules/auth/utils/auth.constant";

export type TLockState = {
  locked: boolean;
  resetRequired: boolean;
  retryAfterSeconds?: number;
};

// Which threshold a failed attempt just crossed, or null when none was.
export type TLockTrigger = "FIRST" | "SECOND" | "TERMINAL" | null;

export function isLoginLockoutEnabled(): boolean {
  return envConfig.LOGIN_LOCKOUT_ENABLED;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Report whether the account is currently locked. A terminal lock outranks any
 * temporary one; an expired temporary lock reads as unlocked without any write.
 */
export async function evaluateLockState(email: string): Promise<TLockState> {
  const doc = await LoginAttempt.findOne({ email: normalizeEmail(email) })
    .select("lockedUntil resetRequired")
    .lean();

  if (!doc) return { locked: false, resetRequired: false };

  if (doc.resetRequired) {
    return { locked: true, resetRequired: true };
  }

  if (doc.lockedUntil && doc.lockedUntil.getTime() > Date.now()) {
    return {
      locked: true,
      resetRequired: false,
      retryAfterSeconds: Math.ceil(
        (doc.lockedUntil.getTime() - Date.now()) / 1000,
      ),
    };
  }

  return { locked: false, resetRequired: false };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

/**
 * Atomically increment the failure counter, creating the document on first
 * failure. Concurrent first failures race to insert the same unique email and
 * one loses with E11000 — retry once, by which point the document exists and
 * the upsert degrades to a plain increment, so no count is lost.
 */
async function incrementFailedCount(key: string, now: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await LoginAttempt.findOneAndUpdate(
        { email: key },
        {
          $inc: { failedCount: 1 },
          $set: {
            lastFailedAt: new Date(now),
            expiresAt: new Date(now + LOGIN_LOCKOUT.ATTEMPT_TTL_MS),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (attempt === 0 && isDuplicateKeyError(error)) continue;
      throw error;
    }
  }
}

/**
 * Record one failed attempt and apply the lock for the threshold it crosses.
 *
 * The `$inc` upsert is atomic, so concurrent failures never lose an increment
 * and each caller reads a distinct post-increment count — exactly one observes
 * each threshold, so the lock write below fires once per threshold.
 */
export async function recordFailedAttempt(
  email: string,
): Promise<{ trigger: TLockTrigger }> {
  const key = normalizeEmail(email);
  const now = Date.now();

  const doc = await incrementFailedCount(key, now);

  const count = doc.failedCount;
  const { THRESHOLDS, DURATIONS_MS } = LOGIN_LOCKOUT;

  if (count >= THRESHOLDS.TERMINAL) {
    // Terminal lock persists until the reset flow clears it, so drop the TTL
    // field — otherwise the sweep would silently unlock the account.
    await LoginAttempt.updateOne(
      { email: key },
      { $set: { resetRequired: true, lockedUntil: null }, $unset: { expiresAt: "" } },
    );
    return { trigger: count === THRESHOLDS.TERMINAL ? "TERMINAL" : null };
  }

  if (count === THRESHOLDS.SECOND) {
    await LoginAttempt.updateOne(
      { email: key },
      { $set: { lockedUntil: new Date(now + DURATIONS_MS.SECOND) } },
    );
    return { trigger: "SECOND" };
  }

  if (count === THRESHOLDS.FIRST) {
    await LoginAttempt.updateOne(
      { email: key },
      { $set: { lockedUntil: new Date(now + DURATIONS_MS.FIRST) } },
    );
    return { trigger: "FIRST" };
  }

  return { trigger: null };
}

/**
 * Reset the counter on a successful login or password reset. Deleting the whole
 * document clears temporary and terminal locks alike.
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  await LoginAttempt.deleteOne({ email: normalizeEmail(email) });
}
