import status from "http-status";
import {
  isDuplicateKeyError,
  productCategoryHelper,
} from "@/modules/product-categories/helpers/product-category.helper";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { ObjectId } from "@/helpers/common";
import { PRODUCT_CATEGORY_MESSAGES } from "@/modules/product-categories/utils/product-category.constant";
import { TProductCategoryController } from "@/modules/product-categories/utils/product-category.types";

/**
 * ProductCategoryAdminController handles admin product-category HTTP requests.
 * companyRef always comes from `req.user`, so admins can never reach another company's categories.
 */
export class ProductCategoryAdminController {
  get: TProductCategoryController["getProductCategories"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const companyRef = req.user!.companyRef!._id;

      const [result] = await productCategoryHelper.findAll({
        ...req.query,
        companyRef,
      });

      return SuccessResponse(res, status.OK, {
        message: PRODUCT_CATEGORY_MESSAGES.SUCCESS,
        data: buildPaginatedResponse(result.items, {
          totalCount: result.total,
          page: result.page,
          pageSize: result.pageSize,
        }),
      });
    } catch (error) {
      next(error);
    }
  };

  create: TProductCategoryController["createProductCategory"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const data = await productCategoryHelper.create({
        name: req.body.name,
        companyRef: req.user!.companyRef!._id,
      });

      return SuccessResponse(res, status.CREATED, {
        message: PRODUCT_CATEGORY_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      // The unique (companyRef, name) index is the source of truth, so concurrent creates can't both win.
      if (isDuplicateKeyError(error)) {
        return ErrorResponse(res, status.CONFLICT, {
          message: PRODUCT_CATEGORY_MESSAGES.DUPLICATE_NAME,
        });
      }
      next(error);
    }
  };

  update: TProductCategoryController["updateProductCategory"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const data = await productCategoryHelper.rename(
        { _id: ObjectId(req.params.id), companyRef: req.user!.companyRef!._id },
        req.body.name,
      );

      if (!data) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: PRODUCT_CATEGORY_MESSAGES.NOT_FOUND,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: PRODUCT_CATEGORY_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return ErrorResponse(res, status.CONFLICT, {
          message: PRODUCT_CATEGORY_MESSAGES.DUPLICATE_NAME,
        });
      }
      next(error);
    }
  };

  delete: TProductCategoryController["deleteProductCategory"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const data = await productCategoryHelper.delete({
        _id: ObjectId(req.params.id),
        companyRef: req.user!.companyRef!._id,
      });

      if (!data) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: PRODUCT_CATEGORY_MESSAGES.NOT_FOUND,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: PRODUCT_CATEGORY_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
