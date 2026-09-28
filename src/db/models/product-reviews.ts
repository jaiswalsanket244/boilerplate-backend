import mongoose from "mongoose";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";

const ObjectId = mongoose.Schema.Types.ObjectId;

export const PRODUCT_REVIEW_LIMITS = {
  MIN_RATING: 1,
  MAX_RATING: 5,
  MAX_REVIEW_LENGTH: 1000,
} as const;

export interface IProductReview {
  _id: mongoose.Types.ObjectId;
  productRef: mongoose.Types.ObjectId;
  userRef: mongoose.Types.ObjectId;
  companyRef: mongoose.Types.ObjectId;
  rating: number;
  review: string;
}

export interface IProductReviewDocument
  extends IProductReview,
    mongoose.Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductReviewSchema = new mongoose.Schema<IProductReviewDocument>(
  {
    productRef: {
      type: ObjectId,
      required: true,
      ref: "Products",
    },
    userRef: {
      type: ObjectId,
      required: true,
      ref: "User",
    },
    companyRef: {
      type: ObjectId,
      required: true,
      ref: "Company",
    },
    rating: {
      type: Number,
      required: true,
      min: PRODUCT_REVIEW_LIMITS.MIN_RATING,
      max: PRODUCT_REVIEW_LIMITS.MAX_RATING,
      validate: {
        validator: Number.isInteger,
        message: "Rating must be an integer",
      },
    },
    review: {
      type: String,
      required: true,
      trim: true,
      maxlength: PRODUCT_REVIEW_LIMITS.MAX_REVIEW_LENGTH,
    },
  },
  { timestamps: true },
);

// One review per user per product; its productRef prefix also serves
// per-product aggregation (average rating / count).
ProductReviewSchema.index({ productRef: 1, userRef: 1 }, { unique: true });
// Newest-first listing of a product's reviews.
ProductReviewSchema.index({ productRef: 1, createdAt: -1 });

ProductReviewSchema.plugin(auditPlugin, {
  model: "productReview",
  labelField: "review",
});

export const ProductReviews = mongoose.model<IProductReviewDocument>(
  "ProductReviews",
  ProductReviewSchema,
);
