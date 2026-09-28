// One-off: rewrites user queries saved with the old "Feature Requests or Feedback"
// subject to USER_QUERY_SUBJECT.FEATURE ("Feedback"). Safe to re-run.
import mongoose from "mongoose";
import envConfig from "@/config/env";
import { UserQuery } from "@/db/models/userQuery";
import { USER_QUERY_SUBJECT } from "@/modules/user-query/utils/user-query.enum";

const LEGACY_FEATURE_SUBJECT = "Feature Requests or Feedback";

async function renameFeedbackSubject() {
  // Connect directly rather than via connectDB, which logs and swallows connection errors.
  await mongoose.connect(envConfig.DB_PATH);
  try {
    const result = await UserQuery.updateMany(
      { subject: LEGACY_FEATURE_SUBJECT },
      { $set: { subject: USER_QUERY_SUBJECT.FEATURE } },
    );
    console.log(
      `[user-query:rename-feedback-subject] updated ${result.modifiedCount} of ${result.matchedCount} matched`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

renameFeedbackSubject().then(
  () => process.exit(0),
  (err) => {
    console.error("[user-query:rename-feedback-subject] failed", err);
    process.exit(1);
  },
);
