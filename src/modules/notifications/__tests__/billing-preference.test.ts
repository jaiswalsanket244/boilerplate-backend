import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { NOTIFICATION_CHANNEL, NOTIFICATION_TYPE } from "@/enums";
import { generateDefaultNotificationPreferences } from "@/helpers/notification";
import { createUserSession } from "@/tests/utils/auth";

describe("billing notification preference", () => {
  const app = createApp();

  describe("generateDefaultNotificationPreferences", () => {
    it("enables billing email by default", () => {
      const defaults = generateDefaultNotificationPreferences();

      expect(defaults[NOTIFICATION_TYPE.BILLING]).toEqual({
        [NOTIFICATION_CHANNEL.PUSH]: true,
        [NOTIFICATION_CHANNEL.EMAIL]: true,
        [NOTIFICATION_CHANNEL.IN_APP]: false,
      });
    });

    it("keeps email off for every other type", () => {
      const defaults = generateDefaultNotificationPreferences();

      for (const type of Object.values(NOTIFICATION_TYPE)) {
        if (type === NOTIFICATION_TYPE.BILLING) continue;
        expect(defaults[type]).toEqual({
          [NOTIFICATION_CHANNEL.PUSH]: true,
          [NOTIFICATION_CHANNEL.EMAIL]: false,
          [NOTIFICATION_CHANNEL.IN_APP]: false,
        });
      }
    });
  });

  describe("PUT /api/notification/preferences", () => {
    it("accepts the billing type and stores the channel change", async () => {
      const session = await createUserSession();

      const res = await request(app)
        .put("/api/notification/preferences")
        .set("Cookie", session.cookie)
        .send({ type: NOTIFICATION_TYPE.BILLING, channels: { email: false } });

      expect(res.status).toBe(200);
      const doc = await UserNotificationPreference.findOne({
        userRef: session.user._id,
      }).lean();
      expect(doc?.preferences[NOTIFICATION_TYPE.BILLING]?.email).toBe(false);
    });

    it("rejects an unknown type", async () => {
      const session = await createUserSession();

      const res = await request(app)
        .put("/api/notification/preferences")
        .set("Cookie", session.cookie)
        .send({ type: "not_a_type", channels: { email: false } });

      expect(res.status).toBe(400);
    });
  });
});
