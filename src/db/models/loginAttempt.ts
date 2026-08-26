import mongoose, { Schema } from "mongoose";

/**
 * Tracks failed login attempts per email for the account-lockout feature.
 * Kept as its own collection (not fields on User) so it stays off the User
 * auditPlugin, which would otherwise emit an audit row per failed attempt.
 */
export interface ILoginAttempt {
  email: string;
  failedCount: number;
  // Temporary-lock expiry. Null when the account is not under a timed lock.
  lockedUntil: Date | null;
  // Terminal lock — cleared only by the password-reset flow.
  resetRequired: boolean;
  lastFailedAt: Date;
  // TTL anchor. Null on terminal locks so they are never auto-reaped.
  expiresAt: Date | null;
}

const LoginAttemptSchema = new Schema<ILoginAttempt>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
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
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// TTL cleanup of stale attempt records. Documents whose expiresAt is null
// (terminal locks) are skipped by the reaper, so they persist until reset.
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = mongoose.model<ILoginAttempt>(
  "LoginAttempt",
  LoginAttemptSchema,
);
