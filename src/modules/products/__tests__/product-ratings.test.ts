import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";
import mongoose from "mongoose";

import { ProductReviews } from "@/db/models/product-reviews";
import {
  createAdminSession,
  createSuperAdminSession,
  seedProduct,
} from "@/tests/utils/auth";

const seedReviews = (
  product: {
    _id: mongoose.Types.ObjectId;
    companyRef: mongoose.Types.ObjectId;
  },
  ratings: number[],
) =>
  ProductReviews.insertMany(
    ratings.map((rating, i) => ({
      productRef: product._id,
      userRef: new mongoose.Types.ObjectId(),
      companyRef: product.companyRef,
      rating,
      review: `Review ${i}`,
    })),
  );

const byId = (items: { _id: string }[], id: mongoose.Types.ObjectId) =>
  items.find((item) => item._id === id.toString());

describe("Product rating summary on fetch endpoints", () => {
  const app = createApp();

  describe("GET /api/products", () => {
    it("adds averageRating and reviewCount per product without leaking across products", async () => {
      const session = await createAdminSession();
      const rated = await seedProduct(session.company._id);
      const other = await seedProduct(session.company._id);
      const unrated = await seedProduct(session.company._id);
      await seedReviews(rated, [5, 4, 4]);
      await seedReviews(other, [1]);

      const res = await request(app)
        .get("/api/products")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      const items = res.body.data.data;
      expect(items).toHaveLength(3);
      expect(byId(items, rated._id)).toMatchObject({
        averageRating: 4.3,
        reviewCount: 3,
      });
      expect(byId(items, other._id)).toMatchObject({
        averageRating: 1,
        reviewCount: 1,
      });
      expect(byId(items, unrated._id)).toMatchObject({
        averageRating: 0,
        reviewCount: 0,
      });
      expect(byId(items, rated._id)).not.toHaveProperty("ratingSummary");
    });

    it("rates the requested page while keeping pagination totals", async () => {
      const session = await createAdminSession();
      const older = await seedProduct(session.company._id, {
        createdAt: new Date("2026-01-01"),
      });
      await seedReviews(older, [2, 3]);
      const newer = await seedProduct(session.company._id, {
        createdAt: new Date("2026-02-01"),
      });
      await seedReviews(newer, [5]);

      const res = await request(app)
        .get("/api/products?page=2&pageSize=1")
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.data[0]).toMatchObject({
        _id: older._id.toString(),
        averageRating: 2.5,
        reviewCount: 2,
      });
      expect(res.body.data.pagination).toMatchObject({
        currentPage: 2,
        pageSize: 1,
        totalCount: 2,
      });
    });
  });

  describe("GET /api/products/:id", () => {
    it("includes averageRating and reviewCount", async () => {
      const session = await createAdminSession();
      const product = await seedProduct(session.company._id);
      await seedReviews(product, [5, 4, 4]);
      await seedReviews(await seedProduct(session.company._id), [1, 1]);

      const res = await request(app)
        .get(`/api/products/${product._id}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        _id: product._id.toString(),
        title: product.title,
        averageRating: 4.3,
        reviewCount: 3,
      });
      expect(res.body.data).not.toHaveProperty("ratingSummary");
    });

    it("returns 0/0 for a product with no reviews", async () => {
      const session = await createAdminSession();
      const product = await seedProduct(session.company._id);

      const res = await request(app)
        .get(`/api/products/${product._id}`)
        .set("Cookie", session.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ averageRating: 0, reviewCount: 0 });
    });

    it("still returns null data for another company's product", async () => {
      const sessionA = await createAdminSession();
      const sessionB = await createAdminSession();
      const productB = await seedProduct(sessionB.company._id);
      await seedReviews(productB, [5]);

      const res = await request(app)
        .get(`/api/products/${productB._id}`)
        .set("Cookie", sessionA.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });

  describe("GET /api/super-admin/products", () => {
    it("adds averageRating and reviewCount to list items", async () => {
      const superAdmin = await createSuperAdminSession();
      const companyId = new mongoose.Types.ObjectId();
      const rated = await seedProduct(companyId);
      const unrated = await seedProduct(companyId);
      await seedReviews(rated, [5, 4, 4]);

      const res = await request(app)
        .get("/api/super-admin/products?pageSize=100")
        .set("Cookie", superAdmin.cookie);

      expect(res.status).toBe(200);
      const items = res.body.data[0].items;
      expect(byId(items, rated._id)).toMatchObject({
        averageRating: 4.3,
        reviewCount: 3,
      });
      expect(byId(items, unrated._id)).toMatchObject({
        averageRating: 0,
        reviewCount: 0,
      });
    });
  });

  describe("GET /api/super-admin/products/:id", () => {
    it("includes averageRating and reviewCount", async () => {
      const superAdmin = await createSuperAdminSession();
      const product = await seedProduct(new mongoose.Types.ObjectId());
      await seedReviews(product, [3, 4]);

      const res = await request(app)
        .get(`/api/super-admin/products/${product._id}`)
        .set("Cookie", superAdmin.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        _id: product._id.toString(),
        averageRating: 3.5,
        reviewCount: 2,
      });
    });

    it("returns null data for an unknown product", async () => {
      const superAdmin = await createSuperAdminSession();

      const res = await request(app)
        .get(`/api/super-admin/products/${new mongoose.Types.ObjectId()}`)
        .set("Cookie", superAdmin.cookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });
});
