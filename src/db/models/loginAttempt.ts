import mongoose, { Schema } from "mongoose";

/**
 * Per-account failed-login tracking for the login lockout policy.
 *
 * Kept in its own collection rather than on `User` on purpose: `User` carries
 * the audit plugin, so writing a failed-attempt counter there would emit an
 * audit row on every wrong password. Keyed by email (the identifier the caller
 * supplies before any user is resolved) with a TTL index for cleanup only.
 */
export interface ILoginAttempt {
  email: string;
  failedCount: number;
  // Set while a temporary lock is in force; null once it has elapsed.
  lockedUntil?: Date | null;
  // Terminal lock — cleared only by the password-reset flow.
  resetRequired: boolean;
  lastFailedAt: Date;
  // TTL anchor: the row is removed once this passes (cleanup, not decay).
  expiresAt: Date;
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
      lowercase: true,
      trim: true,
      unique: true,
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
    lastFailedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Auto-remove idle attempt rows. This is cleanup only — `expiresAt` is pushed
// forward on every failed attempt, so it never ages out an active counter.
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = mongoose.model<ILoginAttemptDocument>(
  "LoginAttempt",
  LoginAttemptSchema,
);
