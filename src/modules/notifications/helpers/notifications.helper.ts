import { type INotifications, Notification } from "@/db/models/notifications";
import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { DIGEST_FREQUENCY, NOTIFICATION_TYPE } from "@/enums";
import {
  ICreateNotificationOptions,
  IUpdatePreferenceInput,
  IUserNotificationPreference,
  TNotification,
} from "@/modules/notifications/utils/notifications.types";
import { pushNotificationService } from "@/providers/push-notification";
import { socketService } from "@/providers/socket";
import { TObjectId } from "@/types";
import { PAGINATION } from "@/constants/pagination";
import { generateDefaultNotificationPreferences } from "@/helpers/notification";
import { createFacetPipeline } from "@/helpers/query";
import { PaginatedSearchQuery } from "@/types/query.types";
import { FilterQuery } from "mongoose";

class NotificationsHelper {
  async findAll(
    condition: FilterQuery<INotifications>,
    query?: PaginatedSearchQuery,
  ) {
    const page = query?.page || PAGINATION.DEFAULT_PAGE;
    const limit = query?.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
    const skips = (page - 1) * limit;

    const facetPipeline = createFacetPipeline(page, skips, limit);

    return Notification.aggregate([
      {
        $match: condition,
      },
      ...facetPipeline,
    ]);
  }

  async create(
    data: Omit<INotifications, "_id" | "isOpened">,
    options: ICreateNotificationOptions = { createNotificationInDb: true },
  ) {
    const userId = data.userRef.toString();
    let notification = null;

    if (options.createNotificationInDb) {
      notification = await Notification.create(data);
      socketService.emitToUser(userId, "update-notifications-count");
    }

    if (options?.channels?.push) {
      await pushNotificationService.sendNotification({
        userId,
        title: data.title,
        message: data.message,
        webUrl: data.redirectUrl,
        data: {
          notificationId: notification?._id.toString(),
        },
      });
    }
  }

  async findOne(condition: FilterQuery<INotifications>) {
    return Notification.find(condition).limit(10).sort({ createdAt: -1 });
  }

  async findAndUpdate({ id, update }: { id: string; update: TNotification }) {
    return Notification.findByIdAndUpdate(id, update);
  }

  async delete(_id: string, userRef: TObjectId) {
    return Notification.deleteOne({ _id, userRef });
  }

  async clearNotifications(userRef: TObjectId) {
    return Notification.deleteMany({ userRef });
  }

  async getUnreadCount(userRef: TObjectId) {
    return Notification.countDocuments({ userRef, isOpened: false });
  }

  async markAllAsRead(condition: FilterQuery<INotifications>) {
    return Notification.updateMany(condition, { isOpened: true });
  }

  async updatePreference(
    userRef: TObjectId,
    type: NOTIFICATION_TYPE,
    update: IUpdatePreferenceInput,
  ): Promise<IUserNotificationPreference | null> {
    const doc = await this.addPreferences(userRef);

    const { preferences } = doc.toJSON();

    const { channels, digestFrequency } = update;
    const updatedPreferences = {
      ...preferences,
      [type]: {
        ...preferences[type],
        ...channels,
        ...(digestFrequency ? { digestFrequency } : {}),
      },
    };

    return UserNotificationPreference.findOneAndUpdate(
      { userRef },
      { preferences: updatedPreferences },
      { new: true },
    );
  }

  async addPreferences(userRef: TObjectId) {
    const existing = await UserNotificationPreference.findOne({ userRef });
    if (existing) return existing;

    const newPrefs = new UserNotificationPreference({
      userRef,
      preferences: generateDefaultNotificationPreferences(),
    });
    return newPrefs.save();
  }

  async getPreferences(userRef: TObjectId) {
    return UserNotificationPreference.findOne({ userRef }).lean();
  }

  async getMultiplePreferences(userRefs: TObjectId[]) {
    return UserNotificationPreference.find({
      userRef: { $in: userRefs },
    }).lean();
  }

  /*
  Preference docs where at least one category is set to `frequency`. The Map is
  stored as a nested object, so we OR over the known categories with dot-notation
  rather than scanning arbitrary keys.
  */
  async getPreferencesByDigestFrequency(frequency: DIGEST_FREQUENCY) {
    const orConditions = Object.values(NOTIFICATION_TYPE).map((type) => ({
      [`preferences.${type}.digestFrequency`]: frequency,
    }));

    return UserNotificationPreference.find({ $or: orConditions }).lean();
  }

  /*
  Unread, not-yet-digested notifications for a user in the given categories.
  Excluding `digestedAt` (rather than flipping `isOpened`) keeps digested items
  unread in-app while guaranteeing they are never included in a second digest.
  */
  async findDigestableNotifications(
    userRef: TObjectId,
    types: NOTIFICATION_TYPE[],
  ) {
    return Notification.find({
      userRef,
      isOpened: false,
      digestedAt: null,
      type: { $in: types },
    })
      .sort({ createdAt: 1 })
      .lean();
  }

  async markAsDigested(ids: TObjectId[], digestedAt: Date) {
    return Notification.updateMany({ _id: { $in: ids } }, { digestedAt });
  }
}

export const notificationsHelper = new NotificationsHelper();
