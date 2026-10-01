import mongoose from "mongoose";
import { auditPlugin } from "@/db/plugins/audit/audit.plugin";

const ObjectId = mongoose.Schema.Types.ObjectId;

export const PRODUCT_CATEGORY_NAME_MAX_LENGTH = 100;

// Strength 2 compares case-insensitively, so "Shoes" and "shoes" collide.
export const PRODUCT_CATEGORY_NAME_COLLATION = { locale: "en", strength: 2 };

export interface IProductCategory {
  _id: mongoose.Types.ObjectId;
  name: string;
  companyRef: mongoose.Types.ObjectId;
}

export interface IProductCategoryDocument
  extends IProductCategory, mongoose.Document {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductCategorySchema = new mongoose.Schema<IProductCategoryDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: PRODUCT_CATEGORY_NAME_MAX_LENGTH,
    },
    companyRef: {
      type: ObjectId,
      required: true,
      ref: "Company",
    },
  },
  { timestamps: true },
);

ProductCategorySchema.index(
  { companyRef: 1, name: 1 },
  { unique: true, collation: PRODUCT_CATEGORY_NAME_COLLATION },
);

ProductCategorySchema.plugin(auditPlugin, {
  model: "productCategory",
  labelField: "name",
});

export const ProductCategory = mongoose.model<IProductCategoryDocument>(
  "ProductCategory",
  ProductCategorySchema,
);
