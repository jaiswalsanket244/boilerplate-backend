import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";
import mongoose from "mongoose";

import { ProductReviews } from "@/db/models/product-reviews";
import { STATUS, USER_TYPE } from "@/enums";
import {
  createAdminSession,
  createTestSession,
  seedProduct,
} from "@/tests/utils/auth";

const reviewsUrl = (productId: unknown) => `/api/products/${productId}/reviews`;

describe("Product review routes", () => {
  const app = createApp();

  // =========================================================================
  // POST /api/products/:id/reviews
  // =========================================================================

  describe("POST /api/products/:id/reviews", () => {
    describe("success", () => {
      it("returns 201 and creates the caller's review", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 4, review: "  Solid product  " });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
          productRef: product._id.toString(),
          userRef: session.user._id.toString(),
          companyRef: session.company._id.toString(),
          rating: 4,
          review: "Solid product",
        });
        expect(res.body.data).toHaveProperty("createdAt");
        expect(res.body.data).toHaveProperty("updatedAt");
      });

      it("updates the existing review when the same user posts again", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const first = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 2, review: "Meh" });
        expect(first.status).toBe(201);

        const second = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 5, review: "Grew on me" });

        expect(second.status).toBe(200);
        expect(second.body.data._id).toBe(first.body.data._id);
        expect(second.body.data).toMatchObject({
          rating: 5,
          review: "Grew on me",
        });

        const docs = await ProductReviews.find({ productRef: product._id });
        expect(docs).toHaveLength(1);
        expect(docs[0].rating).toBe(5);
      });

      it("keeps one review per user when the same user posts concurrently", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const responses = await Promise.all(
          [1, 2, 3].map((rating) =>
            request(app)
              .post(reviewsUrl(product._id))
              .set("Cookie", session.cookie)
              .send({ rating, review: `Take ${rating}` }),
          ),
        );

        for (const res of responses) expect([200, 201]).toContain(res.status);
        expect(
          await ProductReviews.countDocuments({ productRef: product._id }),
        ).toBe(1);
      });

      it("does not overwrite another user's review of the same product", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);
        const otherReview = await ProductReviews.create({
          productRef: product._id,
          userRef: new mongoose.Types.ObjectId(),
          companyRef: session.company._id,
          rating: 1,
          review: "Other user's review",
        });

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 5, review: "Mine" });

        expect(res.status).toBe(201);
        expect(res.body.data._id).not.toBe(otherReview._id.toString());
        expect(
          await ProductReviews.countDocuments({ productRef: product._id }),
        ).toBe(2);
        const untouched = await ProductReviews.findById(otherReview._id);
        expect(untouched).toMatchObject({
          rating: 1,
          review: "Other user's review",
        });
      });
    });

    describe("validation errors", () => {
      it.each([
        ["rating 0", { rating: 0, review: "ok" }],
        ["rating 6", { rating: 6, review: "ok" }],
        ["non-integer rating", { rating: 3.5, review: "ok" }],
        ["string rating", { rating: "4", review: "ok" }],
        ["missing rating", { review: "ok" }],
        ["text over 1000 chars", { rating: 4, review: "a".repeat(1001) }],
        ["whitespace-only text", { rating: 4, review: "   " }],
        ["missing text", { rating: 4 }],
      ])("returns 400 for %s", async (_label, body) => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send(body);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(await ProductReviews.countDocuments()).toBe(0);
      });

      it("accepts text of exactly 1000 chars", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 1, review: "a".repeat(1000) });

        expect(res.status).toBe(201);
      });

      it("returns 400 for a malformed product id", async () => {
        const session = await createAdminSession();

        const res = await request(app)
          .post(reviewsUrl("not-an-id"))
          .set("Cookie", session.cookie)
          .send({ rating: 4, review: "ok" });

        expect(res.status).toBe(400);
      });
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .send({ rating: 4, review: "ok" });

        expect(res.status).toBe(401);
        expect(await ProductReviews.countDocuments()).toBe(0);
      });

      it("returns 403 when the caller lacks products:view", async () => {
        const session = await createTestSession(USER_TYPE.USER, {}, []);
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 4, review: "ok" });

        expect(res.status).toBe(403);
        expect(await ProductReviews.countDocuments()).toBe(0);
      });
    });

    describe("business scenarios", () => {
      it("returns 404 when the product belongs to a different company", async () => {
        const sessionA = await createAdminSession();
        const sessionB = await createAdminSession();
        const productB = await seedProduct(sessionB.company._id);

        const res = await request(app)
          .post(reviewsUrl(productB._id))
          .set("Cookie", sessionA.cookie)
          .send({ rating: 4, review: "ok" });

        expect(res.status).toBe(404);
        expect(await ProductReviews.countDocuments()).toBe(0);
      });

      it("returns 404 when the product is deleted", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id, {
          status: STATUS.DELETED,
        });

        const res = await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 4, review: "ok" });

        expect(res.status).toBe(404);
        expect(await ProductReviews.countDocuments()).toBe(0);
      });

      it("returns 404 when the product does not exist", async () => {
        const session = await createAdminSession();

        const res = await request(app)
          .post(reviewsUrl(new mongoose.Types.ObjectId()))
          .set("Cookie", session.cookie)
          .send({ rating: 4, review: "ok" });

        expect(res.status).toBe(404);
      });
    });
  });

  // =========================================================================
  // GET /api/products/:id/reviews
  // =========================================================================

  describe("GET /api/products/:id/reviews", () => {
    const seedReviews = async (
      product: { _id: mongoose.Types.ObjectId },
      companyRef: mongoose.Types.ObjectId,
      count: number,
    ) => {
      const base = Date.now();
      return ProductReviews.insertMany(
        Array.from({ length: count }, (_, i) => ({
          productRef: product._id,
          userRef: new mongoose.Types.ObjectId(),
          companyRef,
          rating: (i % 5) + 1,
          review: `Review ${i}`,
          createdAt: new Date(base + i * 1000),
        })),
      );
    };

    describe("success", () => {
      it("returns paginated reviews newest first", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);
        await seedReviews(product, session.company._id, 5);

        const page1 = await request(app)
          .get(`${reviewsUrl(product._id)}?page=1&pageSize=2`)
          .set("Cookie", session.cookie);

        expect(page1.status).toBe(200);
        expect(page1.body.data.data.map((r: any) => r.review)).toEqual([
          "Review 4",
          "Review 3",
        ]);
        expect(page1.body.data.pagination).toMatchObject({
          currentPage: 1,
          pageSize: 2,
          totalCount: 5,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: false,
        });

        const page3 = await request(app)
          .get(`${reviewsUrl(product._id)}?page=3&pageSize=2`)
          .set("Cookie", session.cookie);

        expect(page3.status).toBe(200);
        expect(page3.body.data.data.map((r: any) => r.review)).toEqual([
          "Review 0",
        ]);
        expect(page3.body.data.pagination).toMatchObject({
          currentPage: 3,
          hasNextPage: false,
          hasPreviousPage: true,
        });
      });

      it("uses default pagination when no query is given", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);
        await seedReviews(product, session.company._id, 12);

        const res = await request(app)
          .get(reviewsUrl(product._id))
          .set("Cookie", session.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.data).toHaveLength(10);
        expect(res.body.data.pagination).toMatchObject({
          currentPage: 1,
          pageSize: 10,
          totalCount: 12,
        });
      });

      it("includes the reviewer's name but no email or other sensitive fields", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        await request(app)
          .post(reviewsUrl(product._id))
          .set("Cookie", session.cookie)
          .send({ rating: 5, review: "Great" });

        const res = await request(app)
          .get(reviewsUrl(product._id))
          .set("Cookie", session.cookie);

        expect(res.status).toBe(200);
        const [item] = res.body.data.data;
        expect(item).toMatchObject({ rating: 5, review: "Great" });
        expect(item.user).toEqual({
          _id: session.user._id.toString(),
          name: {
            first: session.user.name.first,
            last: session.user.name.last,
          },
        });
        expect(item).not.toHaveProperty("companyRef");
      });

      it("returns only reviews for the requested product", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);
        const other = await seedProduct(session.company._id);
        await seedReviews(product, session.company._id, 2);
        await seedReviews(other, session.company._id, 3);

        const res = await request(app)
          .get(reviewsUrl(product._id))
          .set("Cookie", session.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.pagination.totalCount).toBe(2);
        for (const item of res.body.data.data) {
          expect(item.productRef).toBe(product._id.toString());
        }
      });

      it("returns an empty page when the product has no reviews", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .get(reviewsUrl(product._id))
          .set("Cookie", session.cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.data).toEqual([]);
        expect(res.body.data.pagination.totalCount).toBe(0);
      });
    });

    describe("validation errors", () => {
      it.each([["page=0"], ["pageSize=0"], ["pageSize=101"]])(
        "returns 400 for %s",
        async (qs) => {
          const session = await createAdminSession();
          const product = await seedProduct(session.company._id);

          const res = await request(app)
            .get(`${reviewsUrl(product._id)}?${qs}`)
            .set("Cookie", session.cookie);

          expect(res.status).toBe(400);
        },
      );
    });

    describe("auth errors", () => {
      it("returns 401 when unauthenticated", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id);

        const res = await request(app).get(reviewsUrl(product._id));

        expect(res.status).toBe(401);
      });

      it("returns 403 when the caller lacks products:view", async () => {
        const session = await createTestSession(USER_TYPE.USER, {}, []);
        const product = await seedProduct(session.company._id);

        const res = await request(app)
          .get(reviewsUrl(product._id))
          .set("Cookie", session.cookie);

        expect(res.status).toBe(403);
      });
    });

    describe("business scenarios", () => {
      it("returns 404 when the product belongs to a different company", async () => {
        const sessionA = await createAdminSession();
        const sessionB = await createAdminSession();
        const productB = await seedProduct(sessionB.company._id);
        await seedReviews(productB, sessionB.company._id, 2);

        const res = await request(app)
          .get(reviewsUrl(productB._id))
          .set("Cookie", sessionA.cookie);

        expect(res.status).toBe(404);
      });

      it("returns 404 when the product is deleted", async () => {
        const session = await createAdminSession();
        const product = await seedProduct(session.company._id, {
          status: STATUS.DELETED,
        });
        await seedReviews(product, session.company._id, 2);

        const res = await request(app)
          .get(reviewsUrl(product._id))
          .set("Cookie", session.cookie);

        expect(res.status).toBe(404);
      });
    });
  });
});
