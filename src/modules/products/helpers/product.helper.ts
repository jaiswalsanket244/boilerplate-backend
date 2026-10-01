import { IProductsDocument, Products } from "@/db/models/products";
import { ProductCategory } from "@/db/models/productCategory";
import { PAGINATION } from "@/constants/pagination";
import { STATUS } from "@/enums";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import {
  TGetProductsQuery,
  IProduct,
} from "@/modules/products/utils/product.types";
import { TObjectId } from "@/types";
import { FilterQuery, UpdateQuery } from "mongoose";

class ProductHelper {
  findOne = async (condition: FilterQuery<IProductsDocument>) => {
    return Products.findOne(condition);
  };

  findAll = async (query: TGetProductsQuery) => {
    const page = query.page || PAGINATION.DEFAULT_PAGE;
    const limit = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
    const skips = (page - 1) * limit;
    const searchValue = query.searchValue;
    const sortBy = query.sortBy === "true" ? 1 : -1;
    const companyRef = query.companyRef;

    const companyRefCondition = companyRef
      ? { companyRef: ObjectId(companyRef) }
      : {};
    const categoryRefCondition = query.categoryRef
      ? { categoryRef: ObjectId(query.categoryRef) }
      : {};

    const facetPipeline = createFacetPipeline(page, skips, limit);

    return Products.aggregate([
      {
        $match:
          searchValue && searchValue.length
            ? {
                title: { $regex: searchValue, $options: "i" },
                status: STATUS.ACTIVE,
                ...companyRefCondition,
                ...categoryRefCondition,
              }
            : {
                status: STATUS.ACTIVE,
                ...companyRefCondition,
                ...categoryRefCondition,
              },
      },
      {
        $sort: {
          createdAt: sortBy,
        },
      },
      ...facetPipeline,
    ]);
  };

  categoryBelongsToCompany = async (
    categoryRef: TObjectId | string,
    companyRef: TObjectId | string,
  ) => {
    const category = await ProductCategory.exists({
      _id: ObjectId(categoryRef),
      companyRef: ObjectId(companyRef),
    });
    return Boolean(category);
  };

  create = async ({ categoryRef, ...document }: IProduct) => {
    return Products.create(
      categoryRef ? { ...document, categoryRef } : document,
    );
  };

  /** A `null` categoryRef unsets the field, so uncategorised products never store null. */
  findAndUpdate = async (
    condition: FilterQuery<IProductsDocument>,
    { categoryRef, ...update }: IProduct,
  ) => {
    const updateQuery: UpdateQuery<IProductsDocument> = {
      $set: categoryRef ? { ...update, categoryRef } : update,
    };
    if (categoryRef === null) {
      updateQuery.$unset = { categoryRef: 1 };
    }

    return Products.findOneAndUpdate(condition, updateQuery, {
      returnDocument: "after",
    });
  };

  softDelete = async (condition: FilterQuery<IProductsDocument>) => {
    return Products.findOneAndUpdate(
      condition,
      { $set: { status: STATUS.DELETED } },
      { returnDocument: "after" },
    );
  };
}

export const productHelper = new ProductHelper();
