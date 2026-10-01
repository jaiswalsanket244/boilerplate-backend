import { Products } from "@/db/models/products";
import { createApp } from "@/app";
import { STATUS } from "@/enums";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createAdminSession,
  createSuperAdminSession,
  seedProduct,
  seedProductCategory,
} from "@/tests/utils/auth";
import mongoose from "mongoose";

describe("Product category assignment and filtering", () => {
  const app = createApp();

  function buildProductPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      price: parseFloat(faker.commerce.price({ min: 1, max: 999 })),
      ...overrides,
    };
  }

  describe("POST /api/admin/products", () => {
    it("assigns a category from the admin's company", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id);

      const res = await request(app)
        .post("/api/admin/products")
        .set("Cookie", session.cookie)
        .send(buildProductPayload({ categoryRef: category._id.toString() }));

      expect(res.status).toBe(200);
      expect(res.body.data.categoryRef).toBe(category._id.toString());
      const dbProduct = await Products.findById(res.body.data._id);
      expect(dbProduct?.categoryRef?.toString()).toBe(category._id.toString());
    });

    it("creates an uncategorised product when categoryRef is null", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post("/api/admin/products")
        .set("Cookie", session.cookie)
        .send(buildProductPayload({ categoryRef: null }));

      expect(res.status).toBe(200);
      const dbProduct = await Products.findById(res.body.data._id).lean();
      expect(dbProduct).not.toHaveProperty("categoryRef");
    });

    it("returns 400 for another company's category and creates nothing", async () => {
      const session = await createAdminSession();
      const other = await createAdminSession();
      const otherCategory = await seedProductCategory(other.company._id);

      const res = await request(app)
        .post("/api/admin/products")
        .set("Cookie", session.cookie)
        .send(
          buildProductPayload({ categoryRef: otherCategory._id.toString() }),
        );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(
        await Products.countDocuments({ companyRef: session.company._id }),
      ).toBe(0);
    });

    it("returns 400 for a nonexistent category", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post("/api/admin/products")
        .set("Cookie", session.cookie)
        .send(
          buildProductPayload({
            categoryRef: new mongoose.Types.ObjectId().toString(),
          }),
        );

      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed categoryRef", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .post("/api/admin/products")
        .set("Cookie", session.cookie)
        .send(buildProductPayload({ categoryRef: "not-an-id" }));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Validation error");
    });
  });

  describe("PUT /api/admin/products/:id", () => {
    it("assigns a category from the admin's company", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id);
      const product = await seedProduct(session.company._id);

      const res = await request(app)
        .put(`/api/admin/products/${product._id}`)
        .set("Cookie", session.cookie)
        .send({ categoryRef: category._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.categoryRef).toBe(category._id.toString());
    });

    it("clears the category when categoryRef is null", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id);
      const product = await seedProduct(session.company._id, {
        categoryRef: category._id,
      });

      const res = await request(app)
        .put(`/api/admin/products/${product._id}`)
        .set("Cookie", session.cookie)
        .send({ categoryRef: null });

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("categoryRef");
      const dbProduct = await Products.findById(product._id).lean();
      expect(dbProduct).not.toHaveProperty("categoryRef");
    });

    it("keeps the category when the update does not mention it", async () => {
      const session = await createAdminSession();
      const category = await seedProductCategory(session.company._id);
      const product = await seedProduct(session.company._id, {
        categoryRef: category._id,
      });

      const res = await request(app)
        .put(`/api/admin/products/${product._id}`)
        .set("Cookie", session.cookie)
        .send({ title: "Renamed product" });

      expect(res.status).toBe(200);
      expect(res.body.data.categoryRef).toBe(category._id.toString());
    });

    it("returns 400 for another company's category and leaves the product unchanged", async () => {
      const session = await createAdminSession();
      const other = await createAdminSession();
      const category = await seedProductCategory(session.company._id);
      const otherCategory = await seedProductCategory(other.company._id);
      const product = await seedProduct(session.company._id, {
        categoryRef: category._id,
      });

      const res = await request(app)
        .put(`/api/admin/products/${product._id}`)
        .set("Cookie", session.cookie)
        .send({ categoryRef: otherCategory._id.toString() });

      expect(res.status).toBe(400);
      const dbProduct = await Products.findById(product._id);
      expect(dbProduct?.categoryRef?.toString()).toBe(category._id.toString());
    });

    it("returns 400 for a nonexistent category", async () => {
      const session = await createAdminSession();
      const product = await seedProduct(session.company._id);

      const res = await request(app)
        .put(`/api/admin/products/${product._id}`)
        .set("Cookie", session.cookie)
        .send({ categoryRef: new mongoose.Types.ObjectId().toString() });

      expect(res.status).toBe(400);
    });

    it("ignores a body companyRef so the product stays in the admin's company", async () => {
      const session = await createAdminSession();
      const other = await createAdminSession();
      const category = await seedProductCategory(session.company._id);
      const product = await seedProduct(session.company._id);

      const res = await request(app)
        .put(`/api/admin/products/${product._id}`)
        .set("Cookie", session.cookie)
        .send({
          companyRef: other.company._id.toString(),
          categoryRef: category._id.toString(),
        });

      expect(res.status).toBe(200);
      const dbProduct = await Products.findById(product._id);
      expect(dbProduct?.companyRef.toString()).toBe(
        session.company._id.toString(),
      );
      expect(dbProduct?.categoryRef?.toString()).toBe(category._id.toString());
    });
  });

  describe("POST /api/super-admin/products", () => {
    it("assigns a category from the body companyRef's company", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const category = await seedProductCategory(companyId);

      const res = await request(app)
        .post("/api/super-admin/products")
        .set("Cookie", superAdmin.cookie)
        .send(
          buildProductPayload({
            companyRef: companyId.toString(),
            categoryRef: category._id.toString(),
          }),
        );

      expect(res.status).toBe(200);
      expect(res.body.data.categoryRef).toBe(category._id.toString());
    });

    it("returns 400 when the category belongs to a different company", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const otherCategory = await seedProductCategory(
        new mongoose.Types.ObjectId(),
      );

      const res = await request(app)
        .post("/api/super-admin/products")
        .set("Cookie", superAdmin.cookie)
        .send(
          buildProductPayload({
            companyRef: companyId.toString(),
            categoryRef: otherCategory._id.toString(),
          }),
        );

      expect(res.status).toBe(400);
      expect(await Products.countDocuments({ companyRef: companyId })).toBe(0);
    });
  });

  describe("PUT /api/super-admin/products/:id", () => {
    it("assigns a category from the product's current company", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const category = await seedProductCategory(companyId);
      const product = await seedProduct(companyId);

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({ categoryRef: category._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.categoryRef).toBe(category._id.toString());
    });

    it("returns 400 for a category outside the product's company", async () => {
      const superAdmin = await createSuperAdminSession();
      const product = await seedProduct(new mongoose.Types.ObjectId());
      const otherCategory = await seedProductCategory(
        new mongoose.Types.ObjectId(),
      );

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({ categoryRef: otherCategory._id.toString() });

      expect(res.status).toBe(400);
      const dbProduct = await Products.findById(product._id).lean();
      expect(dbProduct).not.toHaveProperty("categoryRef");
    });

    it("clears the category when categoryRef is null", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const category = await seedProductCategory(companyId);
      const product = await seedProduct(companyId, {
        categoryRef: category._id,
      });

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({ categoryRef: null });

      expect(res.status).toBe(200);
      const dbProduct = await Products.findById(product._id).lean();
      expect(dbProduct).not.toHaveProperty("categoryRef");
    });

    it("clears the old category when moving the product to another company", async () => {
      const superAdmin = await createSuperAdminSession();
      const oldCompanyId = new mongoose.Types.ObjectId();
      const newCompanyId = new mongoose.Types.ObjectId();
      const oldCategory = await seedProductCategory(oldCompanyId);
      const product = await seedProduct(oldCompanyId, {
        categoryRef: oldCategory._id,
      });

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({ companyRef: newCompanyId.toString() });

      expect(res.status).toBe(200);
      const dbProduct = await Products.findById(product._id).lean();
      expect(dbProduct?.companyRef.toString()).toBe(newCompanyId.toString());
      expect(dbProduct).not.toHaveProperty("categoryRef");
    });

    it("keeps the category when companyRef is resent unchanged", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const category = await seedProductCategory(companyId);
      const product = await seedProduct(companyId, {
        categoryRef: category._id,
      });

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({ companyRef: companyId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.data.categoryRef).toBe(category._id.toString());
    });

    it("assigns a category of the new company when moving", async () => {
      const superAdmin = await createSuperAdminSession();
      const oldCompanyId = new mongoose.Types.ObjectId();
      const newCompanyId = new mongoose.Types.ObjectId();
      const oldCategory = await seedProductCategory(oldCompanyId);
      const newCategory = await seedProductCategory(newCompanyId);
      const product = await seedProduct(oldCompanyId, {
        categoryRef: oldCategory._id,
      });

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({
          companyRef: newCompanyId.toString(),
          categoryRef: newCategory._id.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.data.companyRef).toBe(newCompanyId.toString());
      expect(res.body.data.categoryRef).toBe(newCategory._id.toString());
    });

    it("returns 400 and does not move the product when the category belongs to the old company", async () => {
      const superAdmin = await createSuperAdminSession();
      const oldCompanyId = new mongoose.Types.ObjectId();
      const newCompanyId = new mongoose.Types.ObjectId();
      const oldCategory = await seedProductCategory(oldCompanyId);
      const product = await seedProduct(oldCompanyId);

      const res = await request(app)
        .put(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie)
        .send({
          companyRef: newCompanyId.toString(),
          categoryRef: oldCategory._id.toString(),
        });

      expect(res.status).toBe(400);
      const dbProduct = await Products.findById(product._id);
      expect(dbProduct?.companyRef.toString()).toBe(oldCompanyId.toString());
    });
  });

  describe("GET /api/products?categoryRef=", () => {
    it("returns only active products in the category", async () => {
      const session = await createAdminSession();
      const shoes = await seedProductCategory(session.company._id);
      const hats = await seedProductCategory(session.company._id);
      await seedProduct(session.company._id, {
        title: "Running shoe",
        categoryRef: shoes._id,
      });
      await seedProduct(session.company._id, {
        title: "Deleted shoe",
        categoryRef: shoes._id,
        status: STATUS.DELETED,
      });
      await seedProduct(session.company._id, {
        title: "Sun hat",
        categoryRef: hats._id,
      });
      await seedProduct(session.company._id, { title: "Uncategorised" });

      const res = await request(app)
        .get("/api/products")
        .query({ categoryRef: shoes._id.toString() })
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.data.map((p: { title: string }) => p.title)).toEqual(
        ["Running shoe"],
      );
      expect(res.body.data.data[0].categoryRef).toBe(shoes._id.toString());
    });

    it("combines the category filter with search", async () => {
      const session = await createAdminSession();
      const shoes = await seedProductCategory(session.company._id);
      await seedProduct(session.company._id, {
        title: "Trail runner",
        categoryRef: shoes._id,
      });
      await seedProduct(session.company._id, {
        title: "Formal loafer",
        categoryRef: shoes._id,
      });
      await seedProduct(session.company._id, { title: "Trail map" });

      const res = await request(app)
        .get("/api/products")
        .query({ categoryRef: shoes._id.toString(), searchValue: "trail" })
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.data.map((p: { title: string }) => p.title)).toEqual(
        ["Trail runner"],
      );
    });

    it("returns an empty list for another company's category", async () => {
      const session = await createAdminSession();
      const other = await createAdminSession();
      const otherCategory = await seedProductCategory(other.company._id);
      await seedProduct(other.company._id, { categoryRef: otherCategory._id });

      const res = await request(app)
        .get("/api/products")
        .query({ categoryRef: otherCategory._id.toString() })
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(0);
    });

    it("returns 400 for a malformed categoryRef", async () => {
      const session = await createAdminSession();

      const res = await request(app)
        .get("/api/products")
        .query({ categoryRef: "not-an-id" })
        .set("Cookie", session.cookie);

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/super-admin/products?categoryRef=", () => {
    it("returns only active products in the category", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const shoes = await seedProductCategory(companyId);
      const hats = await seedProductCategory(companyId);
      await seedProduct(companyId, {
        title: "Running shoe",
        categoryRef: shoes._id,
      });
      await seedProduct(companyId, {
        title: "Deleted shoe",
        categoryRef: shoes._id,
        status: STATUS.DELETED,
      });
      await seedProduct(companyId, { title: "Sun hat", categoryRef: hats._id });

      const res = await request(app)
        .get("/api/super-admin/products")
        .query({ categoryRef: shoes._id.toString() })
        .set("Cookie", superAdmin.cookie);

      expect(res.status).toBe(200);
      expect(
        res.body.data[0].items.map((p: { title: string }) => p.title),
      ).toEqual(["Running shoe"]);
    });

    it("returns 400 for a malformed categoryRef", async () => {
      const superAdmin = await createSuperAdminSession();

      const res = await request(app)
        .get("/api/super-admin/products")
        .query({ categoryRef: "not-an-id" })
        .set("Cookie", superAdmin.cookie);

      expect(res.status).toBe(400);
    });
  });
});
