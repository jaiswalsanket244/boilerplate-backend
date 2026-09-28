import {
  productValidators,
  GetProductsQuerySchema,
} from "@/modules/products/utils/product.validation";
import { TObjectId } from "@/types";
import z from "zod";

export type TGetProductsQuery = z.infer<typeof GetProductsQuerySchema> & {
  companyRef?: string;
};

export type TProductController = typeof productValidators;

export interface IProduct {
  title?: string;
  productImages?: string[];
  description?: string;
  price?: number;
  /** @deprecated Use `price`. Kept until the frontend product dialog stops using it. */
  costPrice?: number;
  /** @deprecated Use `price`. Kept until the frontend product dialog stops using it. */
  retailPrice?: number;
  /** @deprecated Use `price`. Kept until the frontend product dialog stops using it. */
  salePrice?: number;
  companyRef?: TObjectId | string;
  userRef?: TObjectId | string;
  sellerStripeAccountId?: string;
}
