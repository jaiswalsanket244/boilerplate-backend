import { PRODUCT_CATEGORY_NAME_MAX_LENGTH } from "@/db/models/productCategory";
import { PAGINATION } from "@/constants/pagination";
import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const GetProductCategoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .optional(),
  searchValue: z.string().optional(),
});

const ProductCategoryIdParamsSchema = z.object({
  // Strict 24-hex check: mongoose.isValidObjectId also accepts any 12-char string.
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid category ID"),
});

export const ProductCategoryBodySchema = z.object({
  name: z.string().trim().min(1).max(PRODUCT_CATEGORY_NAME_MAX_LENGTH),
});

// ==================== Validation Schemas ====================

const GetProductCategoriesValidationSchema = {
  query: GetProductCategoriesQuerySchema,
} as const;

const CreateProductCategoryValidationSchema = {
  body: ProductCategoryBodySchema,
} as const;

const UpdateProductCategoryValidationSchema = {
  body: ProductCategoryBodySchema,
  params: ProductCategoryIdParamsSchema,
} as const;

const DeleteProductCategoryValidationSchema = {
  params: ProductCategoryIdParamsSchema,
} as const;

// ==================== Validators ====================

const getProductCategoriesValidator = validate(
  GetProductCategoriesValidationSchema,
  validationErrorHandler,
);

const createProductCategoryValidator = validate(
  CreateProductCategoryValidationSchema,
  validationErrorHandler,
);

const updateProductCategoryValidator = validate(
  UpdateProductCategoryValidationSchema,
  validationErrorHandler,
);

const deleteProductCategoryValidator = validate(
  DeleteProductCategoryValidationSchema,
  validationErrorHandler,
);

export const productCategoryValidators = {
  getProductCategories: getProductCategoriesValidator,
  createProductCategory: createProductCategoryValidator,
  updateProductCategory: updateProductCategoryValidator,
  deleteProductCategory: deleteProductCategoryValidator,
};
