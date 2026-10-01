import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { ProductCategory } from "@/db/models/productCategory";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import {
  createAdminSession,
  createTestSession,
  createUserSession,
  seedProductCategory,
} from "@/tests/utils/auth";
import request from "supertest";
import { describe, expect, it } from "vitest";

const waitFor = async <T>(check: () => Promise<T> | T, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
};

describe("POST /api/admin/product-categories", () => {
  const app = createApp();
  const url = "/api/admin/product-categories";

  describe("success", () => {
    it("creates a category for the caller's company and returns 201", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "  Shoes  ", companyRef: "000000000000000000000000" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Shoes");
      expect(res.body.data.companyRef).toBe(session.company._id.toString());

      const dbCategory = await ProductCategory.findById(res.body.data._id);
      expect(dbCategory?.name).toBe("Shoes");
      expect(dbCategory?.companyRef.toString()).toBe(
        session.company._id.toString(),
      );
      expect(dbCategory?.createdAt).toBeInstanceOf(Date);
      expect(dbCategory?.updatedAt).toBeInstanceOf(Date);
    });

    it("writes an audit log entry labelled with the category name", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "Audited" });
      expect(res.status).toBe(201);

      const row = await waitFor(() =>
        AuditLogModel.findOne({
          companyRef: session.company._id,
          action: "productCategory.created",
        }).lean(),
      );
      expect(row?.target?.label).toBe("Audited");
    });

    it("allows the same name in a different company", async () => {
      const sessionA = await createAdminSession();
      const sessionB = await createAdminSession();
      await seedProductCategory(sessionB.company._id, { name: "Shoes" });

      const res = await request(app)
        .post(url)
        .set("Cookie", sessionA.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(201);
    });

    it("accepts a user who only has products:write", async () => {
      const session = await createTestSession(USER_TYPE.USER, {}, [
        PERMISSIONS.PRODUCTS_WRITE,
      ]);

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "Writer" });

      expect(res.status).toBe(201);
    });
  });

  describe("validation", () => {
    it("returns 400 when name is missing", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when name is only whitespace", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "   " });

      expect(res.status).toBe(400);
    });

    it("returns 400 when name is longer than 100 characters", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "a".repeat(101) });

      expect(res.status).toBe(400);
    });

    it("accepts a name of exactly 100 characters", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "a".repeat(100) });

      expect(res.status).toBe(201);
    });
  });

  describe("business scenarios", () => {
    it("returns 409 when the name already exists in the company", async () => {
      const session = await createAdminSession();
      await seedProductCategory(session.company._id, { name: "Shoes" });

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("returns 409 when the name differs only by case or surrounding spaces", async () => {
      const session = await createAdminSession();
      await seedProductCategory(session.company._id, { name: "Shoes" });

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: " sHOES " });

      expect(res.status).toBe(409);
      expect(
        await ProductCategory.countDocuments({
          companyRef: session.company._id,
        }),
      ).toBe(1);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).post(url).send({ name: "Shoes" });

      expect(res.status).toBe(401);
    });

    it("returns 403 when the user lacks products:write", async () => {
      const session = await createUserSession();

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(403);
    });

    it("returns 403 when the user only has products:view", async () => {
      const session = await createTestSession(USER_TYPE.USER, {}, [
        PERMISSIONS.PRODUCTS_VIEW,
      ]);

      const res = await request(app)
        .post(url)
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(403);
      expect(await ProductCategory.countDocuments()).toBe(0);
    });
  });
});
