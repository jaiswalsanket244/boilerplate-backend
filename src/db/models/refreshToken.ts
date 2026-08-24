import mongoose from "mongoose";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IRefreshToken {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  token: string;
  expiresAt: Date;
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
  },
  {
    timestamps: true,
  },
);

export const RefreshToken = mongoose.model<IRefreshTokenDocument>(
  "RefreshToken",
  RefreshTokenSchema,
);
