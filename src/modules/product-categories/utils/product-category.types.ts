import {
  productCategoryValidators,
  GetProductCategoriesQuerySchema,
} from "@/modules/product-categories/utils/product-category.validation";
import { TObjectId } from "@/types";
import z from "zod";

export type TGetProductCategoriesQuery = z.infer<
  typeof GetProductCategoriesQuerySchema
> & {
  companyRef: TObjectId;
};

export type TProductCategoryController = typeof productCategoryValidators;

export interface IProductCategoryInput {
  name: string;
  companyRef: TObjectId;
}
