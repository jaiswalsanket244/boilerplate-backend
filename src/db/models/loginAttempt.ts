import mongoose, { Schema } from "mongoose";

// Failed-login counter keyed by email. Kept separate from the User document on
// purpose: User carries the auditPlugin, which would emit a record-change audit
// row on every failed attempt.
export interface ILoginAttempt {
  email: string;
  failedCount: number;
  lockedUntil?: Date | null;
  // Terminal lock (threshold 15) — cleared only by the password-reset flow.
  resetRequired: boolean;
  lastFailedAt: Date;
  // TTL field. Unset once a terminal lock is placed so the sweep can never
  // auto-unlock the account (MongoDB TTL ignores documents where this is null).
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
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Sweep abandoned non-terminal counters. Terminal locks unset expiresAt so they
// survive the sweep and only the reset flow can clear them.
LoginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = mongoose.model<ILoginAttemptDocument>(
  "LoginAttempt",
  LoginAttemptSchema,
);
