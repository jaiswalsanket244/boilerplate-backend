import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { ProductCategory } from "@/db/models/productCategory";
import { Products } from "@/db/models/products";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import {
  createAdminSession,
  createTestSession,
  createUserSession,
  seedProduct,
  seedProductCategory,
} from "@/tests/utils/auth";
import mongoose from "mongoose";
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

describe("DELETE /api/admin/product-categories/:id", () => {
  const app = createApp();
  const url = (id: unknown) => `/api/admin/product-categories/${id}`;

  describe("success", () => {
    it("hard-deletes the category, writes an audit entry and returns 200", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id, {
        name: "Shoes",
      });

      const res = await request(app)
        .delete(url(category._id))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(await ProductCategory.findById(category._id)).toBeNull();

      const row = await waitFor(() =>
        AuditLogModel.findOne({
          companyRef: session.company._id,
          action: "productCategory.deleted",
        }).lean(),
      );
      expect(row?.target?.label).toBe("Shoes");
    });

    it("unassigns its products and leaves other categories' products untouched", async () => {
      const session = await createAdminSession();
      const shoes = await seedProductCategory(session.company._id);
      const hats = await seedProductCategory(session.company._id);
      const shoe = await seedProduct(session.company._id, {
        categoryRef: shoes._id,
      });
      const hat = await seedProduct(session.company._id, {
        categoryRef: hats._id,
      });

      const res = await request(app)
        .delete(url(shoes._id))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      const dbShoe = await Products.findById(shoe._id).lean();
      expect(dbShoe).not.toHaveProperty("categoryRef");
      const dbHat = await Products.findById(hat._id);
      expect(dbHat?.categoryRef?.toString()).toBe(hats._id.toString());
    });

    it("lets the same name be created again after deletion", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id, {
        name: "Shoes",
      });

      await request(app)
        .delete(url(category._id))
        .set("Cookie", session.cookie)
        .expect(200);

      const res = await request(app)
        .post("/api/admin/product-categories")
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(201);
    });
  });

  describe("validation", () => {
    it("returns 400 when the id is not a valid ObjectId", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .delete(url("not-an-id"))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(400);
    });
  });

  describe("business scenarios", () => {
    it("returns 404 for a category belonging to another company and keeps it", async () => {
      const sessionA = await createAdminSession();
      const sessionB = await createAdminSession();
      const categoryB = await seedProductCategory(sessionB.company._id);

      const res = await request(app)
        .delete(url(categoryB._id))
        .set("Cookie", sessionA.cookie);

      expect(res.status).toBe(404);
      expect(await ProductCategory.findById(categoryB._id)).not.toBeNull();
    });

    it("leaves products assigned when another company's delete is refused", async () => {
      const sessionA = await createAdminSession();
      const sessionB = await createAdminSession();
      const categoryB = await seedProductCategory(sessionB.company._id);
      const productB = await seedProduct(sessionB.company._id, {
        categoryRef: categoryB._id,
      });

      await request(app)
        .delete(url(categoryB._id))
        .set("Cookie", sessionA.cookie)
        .expect(404);

      const dbProduct = await Products.findById(productB._id);
      expect(dbProduct?.categoryRef?.toString()).toBe(categoryB._id.toString());
    });

    it("returns 404 for an unknown id", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .delete(url(new mongoose.Types.ObjectId()))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(404);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).delete(url(new mongoose.Types.ObjectId()));

      expect(res.status).toBe(401);
    });

    it("returns 403 when the user lacks any products permission", async () => {
      const session = await createUserSession();
      const category = await seedProductCategory(session.company._id);

      const res = await request(app)
        .delete(url(category._id))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(403);
      expect(await ProductCategory.findById(category._id)).not.toBeNull();
    });

    it("returns 403 when the user has products:write but not products:manage", async () => {
      const session = await createTestSession(USER_TYPE.USER, {}, [
        PERMISSIONS.PRODUCTS_WRITE,
      ]);
      const category = await seedProductCategory(session.company._id);

      const res = await request(app)
        .delete(url(category._id))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(403);
      expect(await ProductCategory.findById(category._id)).not.toBeNull();
    });

    it("accepts a user who has products:manage", async () => {
      const session = await createTestSession(USER_TYPE.USER, {}, [
        PERMISSIONS.PRODUCTS_MANAGE,
      ]);
      const category = await seedProductCategory(session.company._id);

      const res = await request(app)
        .delete(url(category._id))
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
    });
  });
});
