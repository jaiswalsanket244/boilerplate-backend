import { connectDB, disconnectDB } from "@/db";
import { migrateNotificationIsOpenedToIsRead } from "@/modules/notifications/helpers/migrate-isread.helper";

/* One-off: renames stored notification `isOpened` to `isRead` (CYR-186).
   Run once right after deploying the rename; rerunning is a no-op. */
async function run(): Promise<void> {
  await connectDB();

  const { renamed, merged } = await migrateNotificationIsOpenedToIsRead();
  console.log(
    `[notifications:migrate-isread] renamed isOpened -> isRead: matched ${renamed.matched}, modified ${renamed.modified}`,
  );
  console.log(
    `[notifications:migrate-isread] merged into existing isRead: matched ${merged.matched}, modified ${merged.modified}`,
  );

  await disconnectDB();
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error(
      "[notifications:migrate-isread] FAILED:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  },
);
