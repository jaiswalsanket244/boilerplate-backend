import {
  IProductCategoryDocument,
  PRODUCT_CATEGORY_NAME_COLLATION,
  ProductCategory,
} from "@/db/models/productCategory";
import { Products } from "@/db/models/products";
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
   * Hard-deletes a category and unassigns its products; deletion is never blocked (CYR-182).
   *
   * The unset runs only after the delete succeeds, so a failed or missed delete never strips
   * products of a category that still exists. Once the category is gone, new assignments to it
   * fail validation, so the unset catches every product assigned before the delete. An
   * assignment validated just before the delete but written after the unset can still leave a
   * reference to the deleted id; that product simply matches no existing category.
   * Scoping by companyRef keeps the unset inside the category's company.
   */
  delete = async (condition: FilterQuery<IProductCategoryDocument>) => {
    const category = await ProductCategory.findOneAndDelete(condition);
    if (category) {
      await Products.updateMany(
        { categoryRef: category._id, companyRef: category.companyRef },
        { $unset: { categoryRef: 1 } },
      );
    }
    return category;
  };
}

export const productCategoryHelper = new ProductCategoryHelper();
