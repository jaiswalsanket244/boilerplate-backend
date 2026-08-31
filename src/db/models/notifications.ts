import mongoose from "mongoose";
import { NOTIFICATION_TYPE } from "@/enums";
const ObjectId = mongoose.Schema.Types.ObjectId;

export interface INotifications {
  _id: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  message: string;
  title: string;
  isOpened: boolean;
  companyRef?: mongoose.Types.ObjectId;
  redirectUrl?: string;
  // Category this notification belongs to. Optional so legacy/untyped
  // notifications remain valid; the digest job only picks up typed ones.
  type?: NOTIFICATION_TYPE;
  // Set once this notification has been included in a sent digest email, so a
  // later digest run never re-sends it. Individual delivery today is push-only.
  digestedAt?: Date | null;
}

export interface INotificationsDocument
  extends INotifications, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new mongoose.Schema<INotificationsDocument>(
  {
    userRef: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    isOpened: {
      type: Boolean,
      default: false,
      required: true,
    },
    companyRef: {
      type: ObjectId,
      ref: "Company",
      required: false,
    },

    title: {
      type: String,
      required: true,
    },
    redirectUrl: {
      type: String,
      required: false,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPE),
      required: false,
    },
    digestedAt: {
      type: Date,
      required: false,
      default: null,
    },
  },
  { timestamps: true },
);

export const Notification = mongoose.model<INotificationsDocument>(
  "Notification",
  NotificationSchema,
);
