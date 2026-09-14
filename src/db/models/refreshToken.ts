import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IRefreshToken {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  token: string;
  expiresAt: Date;
  // Durable per-session identity that survives refresh-token rotation. Optional
  // on the type because legacy rows created before this field existed have none
  // until their next refresh lazily assigns one.
  sessionId?: string;
  userAgent?: string;
  ip?: string;
  lastActiveAt?: Date;
}

export interface IRefreshTokenDocument extends IRefreshToken {
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema = new mongoose.Schema<IRefreshTokenDocument>(
  {
    userId: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    sessionId: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      default: "unknown",
    },
    ip: {
      type: String,
      default: "unknown",
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

RefreshTokenSchema.index({ userId: 1 });
RefreshTokenSchema.index({ sessionId: 1 });

export const RefreshToken = mongoose.model<IRefreshTokenDocument>(
  "RefreshToken",
  RefreshTokenSchema,
);
