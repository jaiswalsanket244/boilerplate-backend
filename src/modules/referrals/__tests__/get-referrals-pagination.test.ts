import { createApp } from "@/app";
import { PAGINATION } from "@/constants/pagination";
import { createAdminSession } from "@/tests/utils/auth";
import request from "supertest";
import { describe, expect, it } from "vitest";

describe("GET /api/referrals — pagination validation", () => {
  const app = createApp();

  describe("accepts in-range pagination", () => {
    it("returns 200 with no pagination params (uses defaults)", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 200 for valid page and pageSize", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals?page=2&pageSize=25")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 200 for pageSize at the MAX_PAGE_SIZE boundary", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get(`/api/referrals?pageSize=${PAGINATION.MAX_PAGE_SIZE}`)
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
    });
  });

  describe("rejects out-of-range pagination", () => {
    it("returns 400 for a negative page", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals?page=-5")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Validation error");
    });

    it("returns 400 for page=0", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals?page=0")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
    });

    it("returns 400 for a pageSize above MAX_PAGE_SIZE", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals?pageSize=100000")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Validation error");
    });

    it("returns 400 for pageSize=0", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals?pageSize=0")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
    });

    it("returns 400 for a non-integer page", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/referrals?page=1.5")
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
    });
  });
});
