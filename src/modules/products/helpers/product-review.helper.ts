import { ProductReviews } from "@/db/models/product-reviews";
import { PAGINATION } from "@/constants/pagination";
import { TGetProductReviewsQuery } from "@/modules/products/utils/product.types";
import { TObjectId } from "@/types";

interface IUpsertProductReview {
  productRef: TObjectId;
  userRef: TObjectId;
  companyRef: TObjectId;
  rating: number;
  review: string;
}

class ProductReviewHelper {
  /**
   * Creates the user's review for a product, or replaces their existing one.
   * Returns the saved review and whether it already existed.
   */
  upsert = async ({
    productRef,
    userRef,
    companyRef,
    rating,
    review,
  }: IUpsertProductReview) => {
    // MongoDB retries an upsert that loses a race on the unique
    // (productRef, userRef) index, so concurrent first POSTs don't 500.
    const result = await ProductReviews.findOneAndUpdate(
      { productRef, userRef },
      { $set: { rating, review, companyRef } },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
        includeResultMetadata: true,
      },
    );

    return {
      review: result.value,
      updatedExisting: Boolean(result.lastErrorObject?.updatedExisting),
    };
  };

  findAllByProduct = async (query: TGetProductReviewsQuery) => {
    const page = query.page || PAGINATION.DEFAULT_PAGE;
    const pageSize = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
    const skips = (page - 1) * pageSize;

    return ProductReviews.aggregate([
      {
        $match: {
          productRef: query.productRef,
          companyRef: query.companyRef,
        },
      },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          // Reviewer lookup runs on the current page only.
          items: [
            { $skip: skips },
            { $limit: pageSize },
            {
              $lookup: {
                from: "users",
                localField: "userRef",
                foreignField: "_id",
                as: "user",
                pipeline: [{ $project: { name: 1, profileImage: 1 } }],
              },
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                productRef: 1,
                rating: 1,
                review: 1,
                createdAt: 1,
                updatedAt: 1,
                user: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
      {
        $project: {
          items: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
          page: { $literal: page },
          pageSize: { $literal: pageSize },
        },
      },
    ]);
  };
}

export const productReviewHelper = new ProductReviewHelper();
