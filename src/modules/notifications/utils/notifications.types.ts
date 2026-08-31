import { notificationsValidators } from "@/modules/notifications/utils/notifications.validation";
import {
  DIGEST_FREQUENCY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_TYPE,
} from "@/enums";
import { TObjectId } from "@/types";

export type TNotification = {
  userId?: TObjectId;
  message?: string;
  isOpened?: boolean;
  companyRef?: TObjectId;
};

export interface ICreateNotificationOptions {
  enabled?: boolean;
  channels?: INotificationChannels;
  createNotificationInDb: boolean;
}

export interface INotificationChannels {
  [NOTIFICATION_CHANNEL.EMAIL]: boolean;
  [NOTIFICATION_CHANNEL.PUSH]: boolean;
  [NOTIFICATION_CHANNEL.IN_APP]: boolean;
}

// Stored per-category preference: the channel toggles plus the digest cadence.
export interface INotificationCategoryPreference extends INotificationChannels {
  digestFrequency: DIGEST_FREQUENCY;
}

// Partial update accepted by the preferences PUT endpoint. Either field may be
// omitted so existing channel-only clients keep working unchanged.
export interface IUpdatePreferenceInput {
  channels?: Partial<INotificationChannels>;
  digestFrequency?: DIGEST_FREQUENCY;
}

export interface IUserNotificationPreference {
  userRef: TObjectId;
  preferences: Record<NOTIFICATION_TYPE, INotificationCategoryPreference>;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TNotificationsController = typeof notificationsValidators;
