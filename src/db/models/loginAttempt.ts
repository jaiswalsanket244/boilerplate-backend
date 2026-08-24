import mongoose, { Schema } from "mongoose";

/**
 * Tracks failed authentication attempts per account so the login flow can lock
 * an individual account after repeated failures (see lockout.helper.ts).
 *
 * This lives in its own collection — deliberately NOT as fields on `User` —
 * because `User` carries the audit plugin and would emit a record-change audit
 * row on every failed guess, flooding the audit log.
 */
export interface ILoginAttempt {
  email: string;
  /** Monotonic counter of consecutive failed attempts. Cleared, never decayed. */
  failedCount: number;
  /** When set and in the future, the account is temporarily locked. */
  lockedUntil?: Date | null;
  /** Terminal lock — only the password-reset flow clears it. */
  resetRequired: boolean;
  /**
   * Housekeeping TTL. Refreshed on each timed-lock write so abandoned records
   * are eventually reclaimed. Left null while a terminal lock is in force so the
   * terminal lock can never be silently expired by the TTL monitor.
   */
  expiresAt?: Date | null;
}

export interface ILoginAttemptDocument extends ILoginAttempt {
  createdAt: Date;
  updatedAt: Date;
}

const LoginAttemptSchema = new Schema<ILoginAttemptDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    resetRequired: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Housekeeping only. MongoDB's TTL monitor ignores documents whose expiresAt is
// null/absent, so terminal locks (expiresAt: null) persist until reset.
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = mongoose.model<ILoginAttemptDocument>(
  "LoginAttempt",
  LoginAttemptSchema,
);
