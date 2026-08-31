import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { DIGEST_FREQUENCY, NOTIFICATION_TYPE } from "@/enums";
import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";

function newUserRef() {
  return new mongoose.Types.ObjectId();
}

describe("notification preferences — digest frequency (CYR-78)", () => {
  it("defaults every category to digestFrequency `off` (unchanged behaviour)", async () => {
    const userRef = newUserRef();

    await notificationsHelper.addPreferences(userRef);

    const doc = await UserNotificationPreference.findOne({ userRef });
    const prefs = doc!.toJSON().preferences;

    expect(prefs[NOTIFICATION_TYPE.CHAT_MESSAGE].digestFrequency).toBe(
      DIGEST_FREQUENCY.OFF,
    );
    expect(prefs[NOTIFICATION_TYPE.PROFILE_AND_PASSWORD].digestFrequency).toBe(
      DIGEST_FREQUENCY.OFF,
    );
  });

  it("PUT writes digestFrequency for a category while leaving channels intact", async () => {
    const userRef = newUserRef();
    await notificationsHelper.addPreferences(userRef);

    await notificationsHelper.updatePreference(
      userRef,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      { digestFrequency: DIGEST_FREQUENCY.WEEKLY },
    );

    const doc = await UserNotificationPreference.findOne({ userRef });
    const category = doc!.toJSON().preferences[NOTIFICATION_TYPE.CHAT_MESSAGE];

    expect(category.digestFrequency).toBe(DIGEST_FREQUENCY.WEEKLY);
    // channel toggles from the default are preserved
    expect(category.push).toBe(true);
    expect(category.email).toBe(false);
  });

  it("channels-only update still works and does not disturb digestFrequency", async () => {
    const userRef = newUserRef();
    await notificationsHelper.addPreferences(userRef);
    await notificationsHelper.updatePreference(
      userRef,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      { digestFrequency: DIGEST_FREQUENCY.DAILY },
    );

    await notificationsHelper.updatePreference(
      userRef,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      { channels: { email: true } },
    );

    const doc = await UserNotificationPreference.findOne({ userRef });
    const category = doc!.toJSON().preferences[NOTIFICATION_TYPE.CHAT_MESSAGE];

    expect(category.email).toBe(true);
    expect(category.digestFrequency).toBe(DIGEST_FREQUENCY.DAILY);
  });
});
