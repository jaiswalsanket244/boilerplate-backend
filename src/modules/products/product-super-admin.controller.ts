import httpStatus from "http-status";

import { productHelper } from "@/modules/products/helpers/product.helper";
import { PRODUCT_MESSAGES } from "@/modules/products/utils/product.constant";
import {
  IProduct,
  TProductController,
} from "@/modules/products/utils/product.types";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";

export class ProductSuperAdminController {
  public get: TProductController["getProducts"] = async (req, res, next) => {
    try {
      const query = req.query;

      const data = await productHelper.findAll(query);

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public getOne: TProductController["getProductById"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id: string = req.params.id;

      const data = await productHelper.findOne({ _id: ObjectId(id) });

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public update: TProductController["updateProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const update = req.body;
      const { companyRef, ...rest } = update;

      const updatedProduct: IProduct = { ...rest };

      if (companyRef) {
        updatedProduct.companyRef = ObjectId(companyRef);
      }

      if (companyRef || rest.categoryRef) {
        const existing = await productHelper.findOne({ _id: ObjectId(id) });
        const targetCompanyRef = companyRef ?? existing?.companyRef;

        if (rest.categoryRef && existing) {
          const isValid = await productHelper.categoryBelongsToCompany(
            rest.categoryRef,
            targetCompanyRef!,
          );
          if (!isValid) {
            return ErrorResponse(res, httpStatus.BAD_REQUEST, {
              message: PRODUCT_MESSAGES.INVALID_CATEGORY,
            });
          }
        }

        // Moving to another company without a new category: always unset, even if `existing`
        // showed none, so a category assigned between this read and the write can't follow the
        // product into a company it doesn't belong to.
        if (
          rest.categoryRef === undefined &&
          existing &&
          !existing.companyRef.equals(ObjectId(companyRef!))
        ) {
          updatedProduct.categoryRef = null;
        }
      }

      const data = await productHelper.findAndUpdate(
        { _id: ObjectId(id) },
        updatedProduct,
      );

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public create: TProductController["createProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const document = req.body;

      if (!document.companyRef) {
        throw new Error("Company Ref is required");
      }

      if (
        document.categoryRef &&
        !(await productHelper.categoryBelongsToCompany(
          document.categoryRef,
          document.companyRef,
        ))
      ) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: PRODUCT_MESSAGES.INVALID_CATEGORY,
        });
      }

      const data = await productHelper.create({
        ...document,
        companyRef: ObjectId(document.companyRef),
        userRef: req.user?._id,
      });

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };

  public delete: TProductController["deleteProduct"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const data = await productHelper.softDelete({
        _id: ObjectId(id),
      });

      return SuccessResponse(res, httpStatus.OK, { message: "Success.", data });
    } catch (error) {
      next(error);
    }
  };
}
