import mongoose from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { sendNotificationDigests } from "@/agenda/helpers/notification-digest.helper";
import { Notification } from "@/db/models/notifications";
import { User } from "@/db/models/user";
import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { DIGEST_FREQUENCY, NOTIFICATION_TYPE } from "@/enums";
import { mockEmailService } from "@/tests/mocks/email-service.mock";

const channelDefaults = { email: false, push: true, inApp: false };

async function seedUser(email: string) {
  return User.create({
    email,
    name: { first: "Test", last: "User" },
  });
}

async function seedPreference(
  userRef: mongoose.Types.ObjectId,
  frequencyByType: Partial<Record<NOTIFICATION_TYPE, DIGEST_FREQUENCY>>,
) {
  const preferences = Object.values(NOTIFICATION_TYPE).reduce(
    (acc, type) => {
      acc[type] = {
        ...channelDefaults,
        digestFrequency: frequencyByType[type] ?? DIGEST_FREQUENCY.OFF,
      };
      return acc;
    },
    {} as Record<NOTIFICATION_TYPE, unknown>,
  );

  return UserNotificationPreference.create({ userRef, preferences });
}

async function seedNotification(
  userRef: mongoose.Types.ObjectId,
  type: NOTIFICATION_TYPE | undefined,
  title: string,
) {
  return Notification.create({
    userRef,
    title,
    message: `${title} body`,
    type,
  });
}

beforeEach(() => {
  mockEmailService.sendEmail.mockReset();
});

describe("notification digest job (CYR-78)", () => {
  it("sends ONE email per user batching all eligible unread notifications", async () => {
    const user = await seedUser("digest@acme.test");
    await seedPreference(user._id, {
      [NOTIFICATION_TYPE.CHAT_MESSAGE]: DIGEST_FREQUENCY.DAILY,
    });
    await seedNotification(
      user._id,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      "Ping one",
    );
    await seedNotification(
      user._id,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      "Ping two",
    );

    await sendNotificationDigests(DIGEST_FREQUENCY.DAILY);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    const [params] = mockEmailService.sendEmail.mock.calls[0];
    expect(params.to).toBe("digest@acme.test");
    expect(params.text).toContain("Ping one");
    expect(params.text).toContain("Ping two");
  });

  it("never re-sends a notification across two runs (idempotency marker)", async () => {
    const user = await seedUser("idempotent@acme.test");
    await seedPreference(user._id, {
      [NOTIFICATION_TYPE.CHAT_MESSAGE]: DIGEST_FREQUENCY.DAILY,
    });
    await seedNotification(
      user._id,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      "Only once",
    );

    await sendNotificationDigests(DIGEST_FREQUENCY.DAILY);
    await sendNotificationDigests(DIGEST_FREQUENCY.DAILY);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    const digested = await Notification.findOne({ userRef: user._id });
    expect(digested!.digestedAt).toBeInstanceOf(Date);
  });

  it("sends NO email to a user with nothing unread/eligible", async () => {
    const user = await seedUser("empty@acme.test");
    await seedPreference(user._id, {
      [NOTIFICATION_TYPE.CHAT_MESSAGE]: DIGEST_FREQUENCY.DAILY,
    });

    await sendNotificationDigests(DIGEST_FREQUENCY.DAILY);

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
  });

  it("leaves `off` categories on immediate delivery — no digest email", async () => {
    const user = await seedUser("off@acme.test");
    await seedPreference(user._id, {
      [NOTIFICATION_TYPE.CHAT_MESSAGE]: DIGEST_FREQUENCY.OFF,
    });
    await seedNotification(
      user._id,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      "Immediate",
    );

    await sendNotificationDigests(DIGEST_FREQUENCY.DAILY);

    expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    const untouched = await Notification.findOne({ userRef: user._id });
    expect(untouched!.digestedAt).toBeNull();
  });

  it("excludes notifications from a different cadence and untyped legacy rows", async () => {
    const user = await seedUser("mixed@acme.test");
    await seedPreference(user._id, {
      [NOTIFICATION_TYPE.CHAT_MESSAGE]: DIGEST_FREQUENCY.DAILY,
      [NOTIFICATION_TYPE.PROFILE_AND_PASSWORD]: DIGEST_FREQUENCY.WEEKLY,
    });
    await seedNotification(
      user._id,
      NOTIFICATION_TYPE.CHAT_MESSAGE,
      "Daily item",
    );
    await seedNotification(
      user._id,
      NOTIFICATION_TYPE.PROFILE_AND_PASSWORD,
      "Weekly item",
    );
    await seedNotification(user._id, undefined, "Legacy untyped");

    await sendNotificationDigests(DIGEST_FREQUENCY.DAILY);

    expect(mockEmailService.sendEmail).toHaveBeenCalledTimes(1);
    const [params] = mockEmailService.sendEmail.mock.calls[0];
    expect(params.text).toContain("Daily item");
    expect(params.text).not.toContain("Weekly item");
    expect(params.text).not.toContain("Legacy untyped");
  });
});
