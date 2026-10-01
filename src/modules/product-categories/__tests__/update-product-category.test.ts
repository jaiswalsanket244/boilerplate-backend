import { createApp } from "@/app";
import { ProductCategory } from "@/db/models/productCategory";
import { PERMISSIONS, USER_TYPE } from "@/enums";
import {
  createAdminSession,
  createTestSession,
  createUserSession,
  seedProductCategory,
} from "@/tests/utils/auth";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";

describe("PUT /api/admin/product-categories/:id", () => {
  const app = createApp();
  const url = (id: unknown) => `/api/admin/product-categories/${id}`;

  describe("success", () => {
    it("renames the category and returns 200", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id, {
        name: "Shoes",
      });

      const res = await request(app)
        .put(url(category._id))
        .set("Cookie", session.cookie)
        .send({ name: " Footwear " });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Footwear");
      expect((await ProductCategory.findById(category._id))?.name).toBe(
        "Footwear",
      );
    });

    it("allows changing only the case of the category's own name", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id, {
        name: "shoes",
      });

      const res = await request(app)
        .put(url(category._id))
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Shoes");
    });
  });

  describe("validation", () => {
    it("returns 400 when name is missing", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id);

      const res = await request(app)
        .put(url(category._id))
        .set("Cookie", session.cookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when the id is not a valid ObjectId", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .put(url("not-an-id"))
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(400);
    });
  });

  describe("business scenarios", () => {
    it("returns 409 when another category in the company has the name (any case)", async () => {
      const session = await createAdminSession();
      await seedProductCategory(session.company._id, { name: "Bags" });
      const category = await seedProductCategory(session.company._id, {
        name: "Shoes",
      });

      const res = await request(app)
        .put(url(category._id))
        .set("Cookie", session.cookie)
        .send({ name: "BAGS" });

      expect(res.status).toBe(409);
      expect((await ProductCategory.findById(category._id))?.name).toBe(
        "Shoes",
      );
    });

    it("returns 404 for a category belonging to another company and leaves it unchanged", async () => {
      const sessionA = await createAdminSession();
      const sessionB = await createAdminSession();
      const categoryB = await seedProductCategory(sessionB.company._id, {
        name: "Shoes",
      });

      const res = await request(app)
        .put(url(categoryB._id))
        .set("Cookie", sessionA.cookie)
        .send({ name: "Hacked" });

      expect(res.status).toBe(404);
      expect((await ProductCategory.findById(categoryB._id))?.name).toBe(
        "Shoes",
      );
    });

    it("returns 404 for an unknown id", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .put(url(new mongoose.Types.ObjectId()))
        .set("Cookie", session.cookie)
        .send({ name: "Shoes" });

      expect(res.status).toBe(404);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .put(url(new mongoose.Types.ObjectId()))
        .send({ name: "Shoes" });

      expect(res.status).toBe(401);
    });

    it("returns 403 when the user lacks products:write", async () => {
      const session = await createUserSession();
      const category = await seedProductCategory(session.company._id, {
        name: "Shoes",
      });

      const res = await request(app)
        .put(url(category._id))
        .set("Cookie", session.cookie)
        .send({ name: "Footwear" });

      expect(res.status).toBe(403);
      expect((await ProductCategory.findById(category._id))?.name).toBe(
        "Shoes",
      );
    });

    it("returns 403 when the user only has products:view", async () => {
      const session = await createTestSession(USER_TYPE.USER, {}, [
        PERMISSIONS.PRODUCTS_VIEW,
      ]);
      const category = await seedProductCategory(session.company._id);

      const res = await request(app)
        .put(url(category._id))
        .set("Cookie", session.cookie)
        .send({ name: "Footwear" });

      expect(res.status).toBe(403);
    });
  });
});
