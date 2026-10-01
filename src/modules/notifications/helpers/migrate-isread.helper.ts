import { Notification } from "@/db/models/notifications";

export interface IIsReadMigrationResult {
  renamed: { matched: number; modified: number };
  merged: { matched: number; modified: number };
}

/**
 * One-off migration (CYR-186): moves stored `isOpened` onto `isRead`. Safe to rerun —
 * once no document has `isOpened`, both updates match nothing.
 */
export async function migrateNotificationIsOpenedToIsRead(): Promise<IIsReadMigrationResult> {
  // The native collection is used because mongoose strict mode strips `isOpened`
  // from filters and updates now that it is no longer in the schema.
  const collection = Notification.collection;

  const renamed = await collection.updateMany(
    { isOpened: { $exists: true }, isRead: { $exists: false } },
    { $rename: { isOpened: "isRead" } },
  );

  // Between deploy and this run, the new code can set `isRead: true` on an old
  // document (markAsRead, OneSignal webhook). A plain $rename would overwrite that
  // with the stale `isOpened`, so keep it read if either flag says so.
  const merged = await collection.updateMany(
    { isOpened: { $exists: true }, isRead: { $exists: true } },
    [
      { $set: { isRead: { $or: ["$isRead", "$isOpened"] } } },
      { $unset: "isOpened" },
    ],
  );

  return {
    renamed: { matched: renamed.matchedCount, modified: renamed.modifiedCount },
    merged: { matched: merged.matchedCount, modified: merged.modifiedCount },
  };
}
