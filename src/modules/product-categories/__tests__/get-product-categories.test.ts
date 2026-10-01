import { createApp } from "@/app";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import {
  createAdminSession,
  createTestSession,
  createUserSession,
  seedProductCategory,
} from "@/tests/utils/auth";
import request from "supertest";
import { describe, expect, it } from "vitest";

describe("GET /api/admin/product-categories", () => {
  const app = createApp();
  const url = "/api/admin/product-categories";

  describe("success", () => {
    it("returns only the caller's company's categories, sorted by name", async () => {
      const sessionA = await createAdminSession();
      const sessionB = await createAdminSession();
      await seedProductCategory(sessionA.company._id, { name: "bags" });
      await seedProductCategory(sessionA.company._id, { name: "Accessories" });
      await seedProductCategory(sessionA.company._id, { name: "Shoes" });
      await seedProductCategory(sessionB.company._id, { name: "Other" });

      const res = await request(app).get(url).set("Cookie", sessionA.cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(
        res.body.data.data.map((c: { name: string }) => c.name),
      ).toStrictEqual(["Accessories", "bags", "Shoes"]);
      expect(res.body.data.pagination.totalCount).toBe(3);
    });

    it("returns an empty list when the company has no categories", async () => {
      const session = await createAdminSession();

      const res = await request(app).get(url).set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(0);
      expect(res.body.data.pagination.totalCount).toBe(0);
    });

    it("paginates with page and pageSize", async () => {
      const session = await createAdminSession();
      for (const name of ["A", "B", "C", "D", "E"]) {
        await seedProductCategory(session.company._id, { name });
      }

      const res = await request(app)
        .get(`${url}?page=2&pageSize=2`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(
        res.body.data.data.map((c: { name: string }) => c.name),
      ).toStrictEqual(["C", "D"]);
      expect(res.body.data.pagination).toMatchObject({
        currentPage: 2,
        pageSize: 2,
        totalCount: 5,
        totalPages: 3,
      });
    });

    it("filters by a case-insensitive name search", async () => {
      const session = await createAdminSession();
      await seedProductCategory(session.company._id, { name: "Running Shoes" });
      await seedProductCategory(session.company._id, { name: "Shoe Care" });
      await seedProductCategory(session.company._id, { name: "Bags" });

      const res = await request(app)
        .get(`${url}?searchValue=SHOE`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(
        res.body.data.data.map((c: { name: string }) => c.name),
      ).toStrictEqual(["Running Shoes", "Shoe Care"]);
    });

    it("treats regex characters in the search literally", async () => {
      const session = await createAdminSession();
      await seedProductCategory(session.company._id, { name: "Kids (0-3)" });
      await seedProductCategory(session.company._id, { name: "Kids 4" });

      const res = await request(app)
        .get(`${url}?searchValue=${encodeURIComponent("(0-3)")}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(
        res.body.data.data.map((c: { name: string }) => c.name),
      ).toStrictEqual(["Kids (0-3)"]);
    });

    it("accepts a user who only has products:view", async () => {
      const session = await createTestSession(USER_TYPE.USER, {}, [
        PERMISSIONS.PRODUCTS_VIEW,
      ]);

      const res = await request(app).get(url).set("Cookie", session.cookie);

      expect(res.status).toBe(200);
    });
  });

  describe("validation", () => {
    it("returns 400 when pageSize is above the maximum", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get(`${url}?pageSize=101`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(400);
    });

    it("returns 400 when page is zero", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get(`${url}?page=0`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(400);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get(url);

      expect(res.status).toBe(401);
    });

    it("returns 403 when the user lacks products:view", async () => {
      const session = await createUserSession();

      const res = await request(app).get(url).set("Cookie", session.cookie);

      expect(res.status).toBe(403);
    });
  });
});
