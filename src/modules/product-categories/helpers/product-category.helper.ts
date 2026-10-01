import {
  IProductCategoryDocument,
  PRODUCT_CATEGORY_NAME_COLLATION,
  ProductCategory,
} from "@/db/models/productCategory";
import { createFacetPipeline } from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import {
  IProductCategoryInput,
  TGetProductCategoriesQuery,
} from "@/modules/product-categories/utils/product-category.types";
import { FilterQuery } from "mongoose";

const MONGO_DUPLICATE_KEY = 11000;

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isDuplicateKeyError = (error: unknown) =>
  (error as { code?: number })?.code === MONGO_DUPLICATE_KEY;

class ProductCategoryHelper {
  findAll = async (query: TGetProductCategoriesQuery) => {
    const { page, pageSize, skips } = extractLimitAndOffset(
      query.page,
      query.pageSize,
    );
    const searchValue = query.searchValue?.trim();

    const match: FilterQuery<IProductCategoryDocument> = {
      companyRef: query.companyRef,
    };
    if (searchValue) {
      match.name = { $regex: escapeRegex(searchValue), $options: "i" };
    }

    return ProductCategory.aggregate([
      { $match: match },
      { $sort: { name: 1, _id: 1 } },
      ...createFacetPipeline(page, skips, pageSize),
    ]).collation(PRODUCT_CATEGORY_NAME_COLLATION);
  };

  create = async (document: IProductCategoryInput) => {
    return ProductCategory.create(document);
  };

  rename = async (
    condition: FilterQuery<IProductCategoryDocument>,
    name: string,
  ) => {
    return ProductCategory.findOneAndUpdate(
      condition,
      { $set: { name } },
      { returnDocument: "after", runValidators: true },
    );
  };

  /**
   * Hard-deletes a category. Products assigned to it are unassigned, never blocked
   * (CYR-182); clearing their category reference belongs here once products have one.
   */
  delete = async (condition: FilterQuery<IProductCategoryDocument>) => {
    return ProductCategory.findOneAndDelete(condition);
  };
}

export const productCategoryHelper = new ProductCategoryHelper();
