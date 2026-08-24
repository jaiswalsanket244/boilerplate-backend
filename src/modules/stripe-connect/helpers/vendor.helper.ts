import {
  IVendorDocument,
  StripeConnectVendor,
} from "@/db/models/stripeConnect/vendor";
import {
  TCreateVendor,
  TIncrementAmountOwed,
  TUpdateVendor,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { createFacetPipeline } from "@/helpers/query";
import { PAGINATION } from "@/constants/pagination";
import { FilterQuery } from "mongoose";

/**
 * Update vendor details
 */
export async function updateVendor({ stripeAccountId, update }: TUpdateVendor) {
  return StripeConnectVendor.findOneAndUpdate({ stripeAccountId }, update);
}

/**
 * Increment amount owed to platform
 */
export async function incrementAmountOwed({
  stripeAccountId,
  amount,
}: TIncrementAmountOwed) {
  return StripeConnectVendor.findOneAndUpdate(
    { stripeAccountId },
    {
      $inc: { amountOwedToPlatform: amount },
    },
    {
      new: true,
    },
  );
}

/**
 * Get vendor by stripe account ID
 */
export async function getVendor(condition: FilterQuery<IVendorDocument>) {
  return StripeConnectVendor.findOne(condition);
}

/**
 * Update vendor by account ID
 */
export async function updateVendorByAccountId({
  stripeAccountId,
  update,
}: TUpdateVendor) {
  return StripeConnectVendor.findOneAndUpdate({ stripeAccountId }, update);
}

/**
 * Create a new vendor
 */
export async function createVendor({
  userRef,
  stripeAccountId,
  companyRef,
}: TCreateVendor) {
  return StripeConnectVendor.create({
    userRef,
    stripeAccountId,
    companyRef,
  });
}

/**
 * Get all vendors for super admin with pagination and search
 */
export async function getAllVendors(query: {
  page?: number;
  pageSize?: number;
  searchValue?: string;
}) {
  const limit = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
  const page = query.page || PAGINATION.DEFAULT_PAGE;
  const skips = (page - 1) * limit;
  const searchValue = query.searchValue;

  const facetPipeline = createFacetPipeline(page, skips, limit);

  const result = await StripeConnectVendor.aggregate([
    {
      $lookup: {
        from: "users",
        localField: "userRef",
        foreignField: "_id",
        as: "user",
      },
    },
    {
      $unwind: {
        path: "$user",
      },
    },
    ...(searchValue && searchValue.length
      ? [
          {
            $match: {
              "user.email": { $regex: searchValue, $options: "i" },
            },
          },
        ]
      : []),
    {
      $sort: {
        createdAt: -1,
      },
    },
    {
      $project: {
        _id: 1,
        tier: 1,
        stripeAccountId: 1,
        email: "$user.email",
        name: { $concat: ["$user.name.first", " ", "$user.name.last"] },
      },
    },
    ...facetPipeline,
  ]);

  const data = result[0];

  return buildPaginatedResponse(data.items, {
    page: data.page,
    pageSize: data.pageSize,
    totalCount: data.total,
  });
}
