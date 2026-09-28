import { PAGINATION } from "@/constants/pagination";
import { PRODUCT_REVIEW_LIMITS } from "@/db/models/product-reviews";
import { validationErrorHandler } from "@/helpers/validation-error";
import { isValidObjectId } from "mongoose";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

const ProductReviewParamsSchema = z.object({
  id: z.string().refine(isValidObjectId, "Invalid product ID"),
});

export const CreateProductReviewBodySchema = z.object({
  rating: z
    .number()
    .int()
    .min(PRODUCT_REVIEW_LIMITS.MIN_RATING)
    .max(PRODUCT_REVIEW_LIMITS.MAX_RATING),
  review: z
    .string()
    .trim()
    .min(1, "Review is required")
    .max(PRODUCT_REVIEW_LIMITS.MAX_REVIEW_LENGTH),
});

export const GetProductReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .optional(),
});

// ==================== Validation Schemas ====================

const CreateProductReviewValidationSchema = {
  params: ProductReviewParamsSchema,
  body: CreateProductReviewBodySchema,
} as const;

const GetProductReviewsValidationSchema = {
  params: ProductReviewParamsSchema,
  query: GetProductReviewsQuerySchema,
} as const;

// ==================== Validators ====================

const createProductReviewValidator = validate(
  CreateProductReviewValidationSchema,
  validationErrorHandler,
);

const getProductReviewsValidator = validate(
  GetProductReviewsValidationSchema,
  validationErrorHandler,
);

export const productReviewValidators = {
  createProductReview: createProductReviewValidator,
  getProductReviews: getProductReviewsValidator,
};
