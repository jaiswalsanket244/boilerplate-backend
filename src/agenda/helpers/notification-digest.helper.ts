import { INotifications } from "@/db/models/notifications";
import { User } from "@/db/models/user";
import { DIGEST_FREQUENCY, NOTIFICATION_TYPE } from "@/enums";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { INotificationCategoryPreference } from "@/modules/notifications/utils/notifications.types";
import { emailService } from "@/providers/email";

// `.lean()` may surface the preferences Map as a JS Map or a plain object
// depending on the Mongoose codec path, so read the category robustly for both.
function readCategoryPreference(
  preferences: unknown,
  type: NOTIFICATION_TYPE,
): INotificationCategoryPreference | undefined {
  if (!preferences) return undefined;
  if (preferences instanceof Map) return preferences.get(type);
  return (preferences as Record<string, INotificationCategoryPreference>)[type];
}

function buildDigestEmail(
  notifications: Pick<INotifications, "title" | "message">[],
) {
  const count = notifications.length;
  const lines = notifications.map((n) => `• ${n.title}: ${n.message}`);

  return {
    subject: `You have ${count} new notification${count === 1 ? "" : "s"}`,
    text: `Here is your notification digest:\n\n${lines.join("\n")}`,
  };
}

/**
 * Sends one batched digest email per user for every category set to the given
 * cadence. Skips users with nothing eligible and marks included notifications as
 * digested only after a successful send, so a send failure retries next run.
 */
export const sendNotificationDigests = async (
  frequency: DIGEST_FREQUENCY,
): Promise<void> => {
  // `off` is immediate delivery handled at creation time — never digested.
  if (frequency === DIGEST_FREQUENCY.OFF) return;

  const preferenceDocs =
    await notificationsHelper.getPreferencesByDigestFrequency(frequency);
  if (!preferenceDocs.length) return;

  const userRefs = preferenceDocs.map((p) => p.userRef);
  const users = await User.find({
    _id: { $in: userRefs },
    email: { $exists: true, $ne: null },
  })
    .select("email")
    .lean();
  const emailByUser = new Map(users.map((u) => [u._id.toString(), u.email]));

  const digestedAt = new Date();

  for (const pref of preferenceDocs) {
    const email = emailByUser.get(pref.userRef.toString());
    if (!email) continue;

    const eligibleTypes = Object.values(NOTIFICATION_TYPE).filter(
      (type) =>
        readCategoryPreference(pref.preferences, type)?.digestFrequency ===
        frequency,
    );
    if (!eligibleTypes.length) continue;

    const notifications = await notificationsHelper.findDigestableNotifications(
      pref.userRef,
      eligibleTypes,
    );
    if (!notifications.length) continue;

    const { subject, text } = buildDigestEmail(notifications);
    await emailService.sendEmail({ to: email, subject, text });

    await notificationsHelper.markAsDigested(
      notifications.map((n) => n._id),
      digestedAt,
    );
  }
};
