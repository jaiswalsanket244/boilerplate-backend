import { ISubscriptionDocument, Subscription } from "@/db/models/subscription";
import { paymentGateway } from "@/providers/payment";
import envConfig from "@/config/env";
import Stripe from "stripe";
import { IUser, User } from "@/db/models/user";
import { PaginatedSearchQuery } from "@/types/query.types";
import { createFacetPipeline } from "@/helpers/query";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import {
  ISubscription,
  IUserPlanResponse,
} from "@/modules/subscription/utils/subscription.types";
import { TObjectId } from "@/types";

class SubscriptionHelper {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  /**
   * Find all subscription plans from Stripe
   */
  findAllSubscriptionPlans = async () => {
    // stripe product plan list
    const products = await this.stripe.products.list({ limit: 6 });
    const activeProducts = products.data.filter((product) => product.active);

    // Fetch plans for each product
    const productsWithPlans = await Promise.all(
      activeProducts.map(async (product) => {
        const plans = await this.stripe.plans.list({
          product: product.id,
          limit: 10,
        });
        return { ...product, plans: plans.data };
      }),
    );

    return productsWithPlans;
  };

  /**
   * Find user plans by company reference
   */
  findUserPlans = async (
    companyRef: TObjectId,
  ): Promise<IUserPlanResponse | null> => {
    const subscription = await Subscription.findOne({ companyRef });
    if (!subscription || !subscription?.productId) {
      return null;
    }
    const product = await this.stripe.products.retrieve(
      subscription?.productId,
    );

    return {
      planName: subscription?.planName,
      price: subscription?.price,
      description: product?.description || "",
      period: subscription?.period || "",
      features: product?.marketing_features || "",
      planId: subscription?.planId,
      stripeSubscriptionId: subscription?.stripeSubscriptionId,
      billingCycle: subscription?.currentPeriodEnds,
      status: subscription.status,
      pausedAt: subscription.pausedAt ?? null,
      pauseResumesAt: subscription.pauseResumesAt ?? null,
    };
  };

  /**
   * Find the company's current (active or paused) subscription
   */
  findCurrentSubscription = async (companyRef: TObjectId) => {
    return Subscription.findOne({
      companyRef,
      status: {
        $in: [
          STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
          STRIPE_SUBSCRIPTION_STATUS.PAUSED,
        ],
      },
    });
  };

  /**
   * Sync pause state from a Stripe `customer.subscription.updated` event.
   * Access stays on until the already-paid period ends, then status becomes PAUSED.
   */
  syncPauseState = async (
    existing: ISubscriptionDocument,
    stripeSubscription: Stripe.Subscription,
    eventCreated: number,
  ) => {
    // API 2025-03-31+ moved the billing period onto the item (what this webhook
    // already reads); the installed SDK types still have it on the subscription.
    const item = stripeSubscription.items?.data[0] as
      | (Stripe.SubscriptionItem & {
          current_period_start?: number;
          current_period_end?: number;
        })
      | undefined;
    const periodStart =
      item?.current_period_start ?? stripeSubscription.current_period_start;
    const periodFields = {
      currentPeriodStarts: periodStart,
      currentPeriodEnds:
        item?.current_period_end ?? stripeSubscription.current_period_end,
    };
    const pauseCollection = stripeSubscription.pause_collection;

    if (!pauseCollection) {
      // Resumed, either by the customer or automatically at resumes_at
      return Subscription.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...periodFields,
            status: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
            pausedAt: null,
            pauseResumesAt: null,
          },
        },
      );
    }

    // Fall back to the event time when the pause was set outside this app (e.g. Stripe Dashboard)
    const pausedAt = existing.pausedAt ?? eventCreated;
    const paidPeriodEnded = periodStart >= pausedAt;

    return Subscription.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...periodFields,
          status: paidPeriodEnded
            ? STRIPE_SUBSCRIPTION_STATUS.PAUSED
            : STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
          pausedAt,
          pauseResumesAt: pauseCollection.resumes_at ?? null,
        },
      },
    );
  };

  /**
   * Create a new subscription document
   */
  createSubscription = async (document: ISubscription) => {
    return Subscription.create(document);
  };

  /**
   * Create a Stripe customer for a user
   */
  createStripeCustomer = async (user: IUser) => {
    if (user.stripeCustomerId) {
      return user;
    }

    const newCustomer = await paymentGateway.createCustomer(
      user.fullName,
      user.email,
    );
    user.stripeCustomerId = newCustomer.id;
    return User.findOneAndUpdate(
      { _id: user._id },
      {
        stripeCustomerId: newCustomer.id,
      },
      { new: true },
    );
  };

  /**
   * Find all subscribed users (Super Admin)
   */
  findAll = async (query: PaginatedSearchQuery) => {
    const { page = 1, pageSize = 10, searchValue } = query;
    const skips = (page - 1) * pageSize;

    const facetPipeline = createFacetPipeline(page, skips, pageSize);
    const listedStatuses = [
      STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
      STRIPE_SUBSCRIPTION_STATUS.PAUSED,
    ];

    return Subscription.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userRef",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $match: searchValue?.length
          ? {
              $or: [
                { "user.name.first": { $regex: searchValue, $options: "i" } },
                { "user.name.last": { $regex: searchValue, $options: "i" } },
                { planName: { $regex: searchValue, $options: "i" } },
              ],
              status: { $in: listedStatuses },
            }
          : { status: { $in: listedStatuses } },
      },
      ...facetPipeline,
    ]);
  };
}

export const subscriptionHelper = new SubscriptionHelper();
