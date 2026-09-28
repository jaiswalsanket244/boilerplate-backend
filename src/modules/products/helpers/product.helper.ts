import { IProductsDocument, Products } from "@/db/models/products";
import { ProductReviews } from "@/db/models/product-reviews";
import { PAGINATION } from "@/constants/pagination";
import { STATUS } from "@/enums";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import {
  TGetProductsQuery,
  IProduct,
} from "@/modules/products/utils/product.types";
import { FilterQuery } from "mongoose";

/** Adds `averageRating` (1 decimal, 0 when unreviewed) and `reviewCount`
    to each product document flowing through the pipeline. */
const ratingSummaryStages = () => [
  {
    $lookup: {
      from: ProductReviews.collection.name,
      localField: "_id",
      foreignField: "productRef",
      pipeline: [
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            reviewCount: { $sum: 1 },
          },
        },
      ],
      as: "ratingSummary",
    },
  },
  {
    $addFields: {
      averageRating: {
        $round: [
          {
            $ifNull: [{ $arrayElemAt: ["$ratingSummary.averageRating", 0] }, 0],
          },
          1,
        ],
      },
      reviewCount: {
        $ifNull: [{ $arrayElemAt: ["$ratingSummary.reviewCount", 0] }, 0],
      },
    },
  },
  { $project: { ratingSummary: 0 } },
];

class ProductHelper {
  findOne = async (condition: FilterQuery<IProductsDocument>) => {
    return Products.findOne(condition);
  };

  /** Aggregation does not cast, so `condition` must already hold ObjectIds.
      Resolves to the product with rating fields, or null when not found. */
  findOneWithRating = async (condition: FilterQuery<IProductsDocument>) => {
    const [product] = await Products.aggregate([
      { $match: condition },
      { $limit: 1 },
      ...ratingSummaryStages(),
    ]);
    return product ?? null;
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

    // Rating stages run after skip/limit, so only the current page is rated.
    const facetPipeline = createFacetPipeline(
      page,
      skips,
      limit,
      ratingSummaryStages(),
    );

    return Products.aggregate([
      {
        $match:
          searchValue && searchValue.length
            ? {
                title: { $regex: searchValue, $options: "i" },
                status: STATUS.ACTIVE,
                ...companyRefCondition,
              }
            : { status: STATUS.ACTIVE, ...companyRefCondition },
      },
      {
        $sort: {
          createdAt: sortBy,
        },
      },
      ...facetPipeline,
    ]);
  };

  create = async (document: IProduct) => {
    return Products.create(document);
  };

  findAndUpdate = async (
    condition: FilterQuery<IProductsDocument>,
    update: IProduct,
  ) => {
    return Products.findOneAndUpdate(
      condition,
      { ...update },
      { returnDocument: "after" },
    );
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
