import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { STATUS } from "@/enums";
import { productHelper } from "@/modules/products/helpers/product.helper";
import { productReviewHelper } from "@/modules/products/helpers/product-review.helper";
import { PRODUCT_REVIEW_MESSAGES } from "@/modules/products/utils/product.constant";
import { TProductReviewController } from "@/modules/products/utils/product.types";
import status from "http-status";

/**
 * ProductReviewController class for handling product review HTTP requests
 */
export class ProductReviewController {
  /**
   * Create the caller's review for a product, or update it if one exists
   */
  create: TProductReviewController["createProductReview"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const companyRef = user.companyRef!;

      const product = await productHelper.findOne({
        _id: ObjectId(req.params.id),
        companyRef,
        status: STATUS.ACTIVE,
      });

      if (!product) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: PRODUCT_REVIEW_MESSAGES.PRODUCT_NOT_FOUND,
        });
      }

      const { review, updatedExisting } = await productReviewHelper.upsert({
        productRef: product._id,
        userRef: user._id,
        companyRef: product.companyRef,
        rating: req.body.rating,
        review: req.body.review,
      });

      return SuccessResponse(
        res,
        updatedExisting ? status.OK : status.CREATED,
        {
          message: updatedExisting
            ? PRODUCT_REVIEW_MESSAGES.UPDATED_SUCCESS
            : PRODUCT_REVIEW_MESSAGES.CREATED_SUCCESS,
          data: review,
        },
      );
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get a product's reviews, newest first, with pagination
   */
  get: TProductReviewController["getProductReviews"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const companyRef = req.user!.companyRef!;

      const product = await productHelper.findOne({
        _id: ObjectId(req.params.id),
        companyRef,
        status: STATUS.ACTIVE,
      });

      if (!product) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: PRODUCT_REVIEW_MESSAGES.PRODUCT_NOT_FOUND,
        });
      }

      const result = await productReviewHelper.findAllByProduct({
        ...req.query,
        productRef: product._id,
        companyRef: product.companyRef,
      });

      const data = result[0];

      return SuccessResponse(res, status.OK, {
        message: PRODUCT_REVIEW_MESSAGES.FETCHED_SUCCESS,
        data: buildPaginatedResponse(data.items, {
          totalCount: data.total,
          page: data.page,
          pageSize: data.pageSize,
        }),
      });
    } catch (error) {
      next(error);
    }
  };
}
