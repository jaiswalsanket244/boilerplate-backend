import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { Notification } from "@/db/models/notifications";
import { migrateNotificationIsOpenedToIsRead } from "@/modules/notifications/helpers/migrate-isread.helper";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";

const userRef = new mongoose.Types.ObjectId();

function rawDoc(flags: Record<string, boolean>) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userRef,
    title: "t",
    message: "m",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...flags,
  };
}

async function readRaw(_id: mongoose.Types.ObjectId) {
  return Notification.collection.findOne({ _id });
}

describe("migrateNotificationIsOpenedToIsRead", () => {
  it("renames isOpened to isRead, keeping the stored value", async () => {
    const unread = rawDoc({ isOpened: false });
    const read = rawDoc({ isOpened: true });
    await Notification.collection.insertMany([unread, read]);

    const result = await migrateNotificationIsOpenedToIsRead();

    expect(result.renamed).toEqual({ matched: 2, modified: 2 });
    const unreadAfter = await readRaw(unread._id);
    const readAfter = await readRaw(read._id);
    expect(unreadAfter?.isRead).toBe(false);
    expect(unreadAfter).not.toHaveProperty("isOpened");
    expect(readAfter?.isRead).toBe(true);
    expect(readAfter).not.toHaveProperty("isOpened");
  });

  it("makes old unread notifications count and mark as read", async () => {
    await Notification.collection.insertMany([
      rawDoc({ isOpened: false }),
      rawDoc({ isOpened: false }),
      rawDoc({ isOpened: true }),
    ]);
    expect(await notificationsHelper.getUnreadCount(userRef)).toBe(0);

    await migrateNotificationIsOpenedToIsRead();

    expect(await notificationsHelper.getUnreadCount(userRef)).toBe(2);
    await notificationsHelper.markAllAsRead({ userRef, isRead: false });
    expect(await notificationsHelper.getUnreadCount(userRef)).toBe(0);
  });

  it("keeps isRead true when it was set after deploy on an old document", async () => {
    const readAfterDeploy = rawDoc({ isOpened: false, isRead: true });
    const openedBefore = rawDoc({ isOpened: true, isRead: false });
    await Notification.collection.insertMany([readAfterDeploy, openedBefore]);

    const result = await migrateNotificationIsOpenedToIsRead();

    expect(result.renamed.matched).toBe(0);
    expect(result.merged).toEqual({ matched: 2, modified: 2 });
    for (const doc of [readAfterDeploy, openedBefore]) {
      const after = await readRaw(doc._id);
      expect(after?.isRead).toBe(true);
      expect(after).not.toHaveProperty("isOpened");
    }
  });

  it("leaves notifications created with isRead untouched", async () => {
    const created = await Notification.create({
      userRef,
      title: "t",
      message: "m",
    });
    const before = await readRaw(created._id);

    const result = await migrateNotificationIsOpenedToIsRead();

    expect(result.renamed.matched).toBe(0);
    expect(result.merged.matched).toBe(0);
    expect(await readRaw(created._id)).toEqual(before);
  });

  it("is a no-op when rerun", async () => {
    await Notification.collection.insertMany([
      rawDoc({ isOpened: false }),
      rawDoc({ isOpened: true, isRead: false }),
    ]);
    await migrateNotificationIsOpenedToIsRead();
    const snapshot = await Notification.collection.find().toArray();

    const second = await migrateNotificationIsOpenedToIsRead();

    expect(second).toEqual({
      renamed: { matched: 0, modified: 0 },
      merged: { matched: 0, modified: 0 },
    });
    expect(await Notification.collection.find().toArray()).toEqual(snapshot);
  });
});
