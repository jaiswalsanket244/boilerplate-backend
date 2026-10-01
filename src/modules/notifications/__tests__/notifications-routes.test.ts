import { createApp } from "@/app";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Notification } from "@/db/models/notifications";
import { socketService } from "@/providers/socket";
import { createAdminSession, ITestSession } from "@/tests/utils/auth";

function seedNotification(
  session: ITestSession,
  overrides: Record<string, unknown> = {},
) {
  return Notification.create({
    userRef: session.user._id,
    companyRef: session.company._id,
    title: "Title",
    message: "Message",
    ...overrides,
  });
}

describe("Notification routes expose isRead", () => {
  const app = createApp();

  beforeEach(() => {
    // Socket.IO is not initialised in tests, and emitToUser throws without it.
    vi.spyOn(socketService, "emitToUser").mockImplementation(() => undefined);
  });

  describe("GET /api/notification", () => {
    it("returns items with a boolean isRead and no isOpened", async () => {
      const session = await createAdminSession();
      await seedNotification(session);
      await seedNotification(session, { isRead: true });

      const res = await request(app)
        .get("/api/notification")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      const [page] = res.body.data;
      expect(page.items).toHaveLength(2);
      for (const item of page.items) {
        expect(typeof item.isRead).toBe("boolean");
        expect(item).not.toHaveProperty("isOpened");
      }
      expect(
        page.items.map((i: { isRead: boolean }) => i.isRead).sort(),
      ).toEqual([false, true]);
      expect(JSON.stringify(res.body)).not.toContain("isOpened");
    });
  });

  describe("GET /api/notification/unread-count", () => {
    it("counts only the caller's notifications with isRead: false", async () => {
      const session = await createAdminSession();
      const other = await createAdminSession();
      await seedNotification(session);
      await seedNotification(session);
      await seedNotification(session, { isRead: true });
      await seedNotification(other);

      const res = await request(app)
        .get("/api/notification/unread-count")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ count: 2 });
    });
  });

  describe("POST /api/notification/mark-all-as-read", () => {
    it("marks the caller's unread notifications read and leaves other users untouched", async () => {
      const session = await createAdminSession();
      const other = await createAdminSession();
      await seedNotification(session);
      await seedNotification(session);
      const otherUnread = await seedNotification(other);

      const res = await request(app)
        .post("/api/notification/mark-all-as-read")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("isOpened");
      expect(
        await Notification.countDocuments({
          userRef: session.user._id,
          isRead: false,
        }),
      ).toBe(0);
      expect(
        await Notification.countDocuments({
          userRef: session.user._id,
          isRead: true,
        }),
      ).toBe(2);
      const otherAfter = await Notification.findById(otherUnread._id).lean();
      expect(otherAfter?.isRead).toBe(false);
    });
  });

  describe("POST /api/notification/mark-as-read/:id", () => {
    it("stores isRead: true and the response has no isOpened", async () => {
      const session = await createAdminSession();
      const notification = await seedNotification(session);

      const res = await request(app)
        .post(`/api/notification/mark-as-read/${notification._id}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("isRead");
      expect(res.body.data).not.toHaveProperty("isOpened");
      const stored = await Notification.findById(notification._id).lean();
      expect(stored?.isRead).toBe(true);
    });
  });

  describe("POST /api/notification", () => {
    it("stores the created notification with isRead: false", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post("/api/notification")
        .set("Cookie", session.cookie)
        .send({ title: "Hello", message: "World" });

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("isOpened");
      const stored = await Notification.collection.findOne({
        userRef: session.user._id,
      });
      expect(stored?.isRead).toBe(false);
      expect(stored).not.toHaveProperty("isOpened");
    });
  });

  describe("other routes returning notifications", () => {
    it("GET /:id returns notifications with isRead and no isOpened", async () => {
      const session = await createAdminSession();
      await seedNotification(session);

      // The controller treats :id as a userRef (pre-existing behaviour).
      const res = await request(app)
        .get(`/api/notification/${session.user._id}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].isRead).toBe(false);
      expect(res.body.data[0]).not.toHaveProperty("isOpened");
    });

    it("PUT /:id updates isRead and the response has no isOpened", async () => {
      const session = await createAdminSession();
      const notification = await seedNotification(session);

      const res = await request(app)
        .put(`/api/notification/${notification._id}`)
        .set("Cookie", session.cookie)
        .send({ update: { isRead: true } });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("isRead");
      expect(res.body.data).not.toHaveProperty("isOpened");
      const stored = await Notification.findById(notification._id).lean();
      expect(stored?.isRead).toBe(true);
    });

    it("POST /mark-as-read/:id for an unknown id returns no notification data", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(`/api/notification/mark-as-read/${new mongoose.Types.ObjectId()}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });
});
