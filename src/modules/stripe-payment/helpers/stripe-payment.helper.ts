import { StripePaymentCustomer } from "@/db/models/stripePayment/customer";
import { StripePaymentProducts } from "@/db/models/stripePayment/products";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { REFUND_PERIOD } from "@/modules/stripe-payment/utils/stripe-payment.constant";
import {
  DURATION,
  PLATFORM_FEE_PERCENTAGE,
} from "@/modules/stripe-payment/utils/stripe-payment.enum";
import {
  TCreateCustomer,
  TCreateProduct,
  TCreateTransaction,
  TFindAllProductsParams,
  TGetAllOrdersOptions,
  TGetTransactionsOptions,
  TUpdateCustomer,
  TUpdateTransaction,
  ITransactionDetails,
} from "@/modules/stripe-payment/utils/stripe-payment.types";
import { TObjectId } from "@/types/common.types";
import { ObjectId } from "@/helpers/common";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { createFacetPipeline } from "@/helpers/query";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import weekday from "dayjs/plugin/weekday.js";
import { PipelineStage } from "mongoose";

dayjs.extend(isoWeek);
dayjs.extend(weekday);
dayjs.extend(advancedFormat);

class StripePaymentHelper {
  async findAllProducts({
    companyRef,
    filters = {},
    sorting = {},
    page = 1,
    pageSize = 10,
  }: TFindAllProductsParams) {
    const skips = (page - 1) * pageSize;

    const pipeline = [
      {
        $match: {
          companyRef,
          ...filters,
        },
      },

      ...(Object.keys(sorting).length > 0 ? [{ $sort: sorting }] : []),

      {
        $project: {
          _id: 1,
          title: 1,
          price: 1,
        },
      },

      ...createFacetPipeline(page, skips, pageSize),
    ];

    const result = await StripePaymentProducts.aggregate(pipeline);

    const data = result[0];

    return buildPaginatedResponse(data.items, {
      page,
      pageSize,
      totalCount: data.total,
    });
  }

  async findOneProduct(productId: TObjectId) {
    return StripePaymentProducts.findById(productId);
  }

  async getCustomer(userRef: TObjectId) {
    return StripePaymentCustomer.findOne({ userRef });
  }

  async createCustomer({
    userRef,
    stripeCustomerId,
    companyRef,
  }: TCreateCustomer) {
    return StripePaymentCustomer.create({
      userRef,
      stripeCustomerId,
      companyRef,
    });
  }

  async updateCustomer({ userRef, update }: TUpdateCustomer) {
    return StripePaymentCustomer.findOneAndUpdate({ userRef }, update);
  }

  async createTransaction({
    userRef,
    stripeCustomerId,
    stripeCheckoutSessionId,
    productRef,
    companyRef,
  }: TCreateTransaction) {
    return StripePaymentTransactions.create({
      userRef,
      stripeCustomerId,
      stripeCheckoutSessionId,
      productRef,
      companyRef,
    });
  }

  async findOneOrder(id: TObjectId) {
    return StripePaymentTransactions.findById(id);
  }

  async updateTransaction({ id, update }: TUpdateTransaction) {
    return StripePaymentTransactions.findByIdAndUpdate(
      id,
      { ...update },
      { new: true },
    );
  }

  async getAllOrders(stripeCustomerId: string, options: TGetAllOrdersOptions) {
    const {
      page = 1,
      pageSize = 3,
      filters = {},
      searchFilter,
      sorting,
      skips,
    } = options;

    const pipeline = [];
    let matchCondition = {
      stripeCustomerId,
      paymentStatus: { $ne: PAYMENT_STATUS.PENDING },
    };

    if (Object.keys(filters).length) {
      matchCondition = {
        ...matchCondition,
        ...filters,
      };
    }

    pipeline.push({
      $match: matchCondition,
    });

    pipeline.push(
      {
        $addFields: {
          daysSinceOrder: {
            $divide: [
              { $subtract: [new Date(), "$orderPlacedAt"] },
              1000 * 60 * 60 * 24, // Convert milliseconds to days
            ],
          },
        },
      },
      // Round the daysSinceOrder to a whole number
      {
        $addFields: {
          daysSinceOrder: { $floor: "$daysSinceOrder" },
        },
      },
      // Add a field to indicate refund eligibility
      {
        $addFields: {
          isRefundEligible: {
            $lte: ["$daysSinceOrder", REFUND_PERIOD.ELIGIBILITY_DAYS],
          },
        },
      },
      // Lookup product details
      {
        $lookup: {
          from: "stripepaymentproducts",
          localField: "productRef",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      // Unwind the productDetails array
      {
        $unwind: "$productDetails",
      },
    );

    if (Object.keys(searchFilter).length > 0) {
      pipeline.push({
        $match: searchFilter,
      });
    }

    // add projection
    pipeline.push({
      $project: {
        _id: 1,
        productRef: 1,
        amountPaid: 1,
        orderPlacedAt: 1,
        isRefundEligible: 1,
        daysSinceOrder: 1,
        refunded: 1,
        productName: "$productDetails.title",
        paymentStatus: 1,
        createdAt: 1,
      },
    });

    if (Object.keys(sorting).length) {
      pipeline.push({
        $sort: sorting,
      });
    }
    pipeline.push(...createFacetPipeline(page, skips, pageSize));

    const result = await StripePaymentTransactions.aggregate(pipeline);

    const data = result[0];

    return buildPaginatedResponse(data.items, {
      page: data.page,
      pageSize: data.pageSize,
      totalCount: data.total,
    });
  }

  async getOrdersCount(stripeCustomerId: string) {
    const result = await StripePaymentTransactions.aggregate([
      {
        $match: {
          stripeCustomerId,
          paymentStatus: { $ne: PAYMENT_STATUS.PENDING },
        },
      },
      {
        $lookup: {
          from: "stripepaymentproducts",
          localField: "productRef",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $unwind: "$productDetails",
      },
      {
        $facet: {
          allPayments: [{ $count: "count" }],
          pending: [
            { $match: { paymentStatus: PAYMENT_STATUS.PENDING } },
            { $count: "count" },
          ],
          completed: [
            { $match: { paymentStatus: PAYMENT_STATUS.PAID } },
            { $count: "count" },
          ],
          refunded: [
            { $match: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
            { $count: "count" },
          ],
        },
      },
      {
        $project: {
          allPayments: { $arrayElemAt: ["$allPayments.count", 0] },
          pending: { $arrayElemAt: ["$pending.count", 0] },
          completed: { $arrayElemAt: ["$completed.count", 0] },
          refunded: { $arrayElemAt: ["$refunded.count", 0] },
        },
      },
      {
        $addFields: {
          allPayments: { $ifNull: ["$allPayments", 0] },
          pending: { $ifNull: ["$pending", 0] },
          completed: { $ifNull: ["$completed", 0] },
          refunded: { $ifNull: ["$refunded", 0] },
        },
      },
    ]);

    return (
      result[0] || {
        allPayments: 0,
        pending: 0,
        completed: 0,
        refunded: 0,
      }
    );
  }

  async createProduct(productDetails: TCreateProduct) {
    return StripePaymentProducts.create(productDetails);
  }

  async editProduct(
    productId: string,
    productDetails: Partial<TCreateProduct>,
  ) {
    return StripePaymentProducts.findByIdAndUpdate(productId, productDetails, {
      new: true,
    });
  }

  async deleteProduct(productId: string) {
    return StripePaymentProducts.findByIdAndDelete(productId);
  }

  async calculateEarningChartData(companyRef: string, type: DURATION) {
    const now = dayjs();

    const matchStage: Record<string, unknown> = {
      companyRef: { $eq: ObjectId(companyRef) },
      refunded: false,
      orderPlacedAt: { $exists: true },
    };

    let groupStage: Record<string, any>;
    let sortOptions: Record<string, 1 | -1>;
    let start: dayjs.Dayjs;

    switch (type) {
      case DURATION.MONTHLY:
        start = now.subtract(11, "month").startOf("month"); // last 12 months
        matchStage.orderPlacedAt = { $gte: start.toDate(), $lte: now.toDate() };
        groupStage = {
          _id: {
            month: { $month: "$orderPlacedAt" },
            year: { $year: "$orderPlacedAt" },
          },
          totalEarnings: { $sum: "$amountPaid" },
        };
        sortOptions = { "_id.year": 1, "_id.month": 1 };
        break;

      case DURATION.YEARLY:
        start = now.subtract(4, "year").startOf("year"); // last 5 years
        matchStage.orderPlacedAt = { $gte: start.toDate(), $lte: now.toDate() };
        groupStage = {
          _id: { year: { $year: "$orderPlacedAt" } },
          totalEarnings: { $sum: "$amountPaid" },
        };
        sortOptions = { "_id.year": 1 };
        break;

      case DURATION.WEEKLY:
        start = now.subtract(7, "week").startOf("week"); // last 8 weeks
        matchStage.orderPlacedAt = { $gte: start.toDate(), $lte: now.toDate() };
        groupStage = {
          _id: {
            week: { $week: "$orderPlacedAt" },
            year: { $year: "$orderPlacedAt" },
          },
          totalEarnings: { $sum: "$amountPaid" },
        };
        sortOptions = { "_id.year": 1, "_id.week": 1 };
        break;

      default:
        throw new Error(`Invalid duration type: ${type}`);
    }

    const earnings = await StripePaymentTransactions.aggregate([
      { $match: matchStage },
      { $group: groupStage },
      { $sort: sortOptions },
    ]);

    // Build lookup
    const lookup = new Map<string, number>();
    earnings.forEach((item) => {
      if (type === DURATION.MONTHLY) {
        lookup.set(
          `${item._id.year}-${item._id.month}`,
          this.calculateNetAmount(item.totalEarnings),
        );
      } else if (type === DURATION.YEARLY) {
        lookup.set(
          `${item._id.year}`,
          this.calculateNetAmount(item.totalEarnings),
        );
      } else {
        lookup.set(
          `${item._id.year}-${item._id.week}`,
          this.calculateNetAmount(item.totalEarnings),
        );
      }
    });

    // Fill missing slots with null
    if (type === DURATION.MONTHLY) {
      const months: dayjs.Dayjs[] = [];
      for (let i = 0; i < 12; i++) {
        months.push(start.add(i, "month"));
      }
      return months.map((d) => ({
        label: d.format("MMM"),
        value: lookup.get(`${d.year()}-${d.month() + 1}`) ?? 0,
      }));
    }

    if (type === DURATION.YEARLY) {
      const years: number[] = [];
      for (let i = 0; i < 5; i++) {
        years.push(start.year() + i);
      }
      return years.map((y) => ({
        label: String(y),
        value: lookup.get(`${y}`) ?? 0,
      }));
    }

    if (type === DURATION.WEEKLY) {
      const weeks: dayjs.Dayjs[] = [];
      for (let i = 0; i < 8; i++) {
        weeks.push(start.add(i, "week"));
      }
      return weeks.map((d, idx) => {
        const weekNum = d.isoWeek(); // ISO week number
        return {
          label: `Week ${idx + 1}`,
          value: lookup.get(`${d.year()}-${weekNum}`) ?? 0,
        };
      });
    }
  }

  private calculateNetAmount(grossAmount: number): number {
    if (grossAmount <= 0) return grossAmount;

    const netAmount = grossAmount * (1 - PLATFORM_FEE_PERCENTAGE.PERCENTAGE);

    return Number.isInteger(netAmount)
      ? netAmount // Return the number as-is if it's an integer
      : Math.round(netAmount * 10) / 10; // If it's not an integer, round it to one decimal place
  }

  async getTransactions(options: TGetTransactionsOptions) {
    const {
      companyRef,
      page = 1,
      pageSize,
      filters,
      searchFilter,
      sorting,
      skips,
    } = options;

    const pipeline: PipelineStage[] = [];

    const matchCondition = {
      companyRef: ObjectId(companyRef),
      ...filters,
    };

    if (Object.keys(matchCondition).length > 0) {
      pipeline.push({
        $match: matchCondition,
      });
    }

    // join product and customer table
    pipeline.push(
      {
        $lookup: {
          from: "stripepaymentproducts",
          localField: "productRef",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "users",
          localField: "userRef",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
    );

    if (searchFilter && Object.keys(searchFilter).length > 0) {
      pipeline.push({
        $match: searchFilter,
      });
    }

    pipeline.push({
      $project: {
        _id: 1,
        userName: { $concat: ["$user.name.first", " ", "$user.name.last"] },
        productName: "$product.title",
        amount: {
          $multiply: ["$amountPaid", 1 - PLATFORM_FEE_PERCENTAGE.PERCENTAGE],
        },
        orderPlacedAt: 1,
        createdAt: 1,
        paymentStatus: 1,
        refunded: 1,
      },
    });

    if (sorting && Object.keys(sorting).length > 0)
      pipeline.push({ $sort: sorting });

    // Add pagination using the helper
    pipeline.push(...createFacetPipeline(page, skips, pageSize));

    // Execute the aggregation
    const result = await StripePaymentTransactions.aggregate(pipeline);

    // Extract the result from the facet structure
    const data = result[0];

    return buildPaginatedResponse<ITransactionDetails>(data.items, {
      page: data.page,
      pageSize: data.pageSize,
      totalCount: data.total,
    });
  }

  async countTransactions(companyRef: string) {
    const result = await StripePaymentTransactions.aggregate([
      {
        $match: { companyRef: ObjectId(companyRef) },
      },
      {
        $facet: {
          allPayments: [{ $count: "count" }],
          pending: [
            { $match: { paymentStatus: PAYMENT_STATUS.PENDING } },
            { $count: "count" },
          ],
          completed: [
            { $match: { paymentStatus: PAYMENT_STATUS.PAID } },
            { $count: "count" },
          ],
          refunded: [
            { $match: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
            { $count: "count" },
          ],
        },
      },
      {
        $project: {
          allPayments: { $arrayElemAt: ["$allPayments.count", 0] },
          pending: { $arrayElemAt: ["$pending.count", 0] },
          completed: { $arrayElemAt: ["$completed.count", 0] },
          refunded: { $arrayElemAt: ["$refunded.count", 0] },
        },
      },
      {
        $addFields: {
          allPayments: { $ifNull: ["$allPayments", 0] },
          pending: { $ifNull: ["$pending", 0] },
          completed: { $ifNull: ["$completed", 0] },
          refunded: { $ifNull: ["$refunded", 0] },
        },
      },
    ]);

    return (
      result[0] || {
        allPayments: 0,
        pending: 0,
        completed: 0,
        refunded: 0,
      }
    );
  }
}

export const stripePaymentHelper = new StripePaymentHelper();
