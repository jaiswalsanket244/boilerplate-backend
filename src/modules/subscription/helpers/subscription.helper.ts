import { Subscription } from "@/db/models/subscription";
import { paymentGateway } from "@/providers/payment";
import envConfig from "@/config/env";
import Stripe from "stripe";
import { IUser, User } from "@/db/models/user";
import { PaginatedSearchQuery } from "@/types/query.types";
import { createFacetPipeline } from "@/helpers/query";
import { STATUS } from "@/enums";
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
    };
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
              status: STATUS.ACTIVE,
            }
          : { status: STATUS.ACTIVE },
      },
      ...facetPipeline,
    ]);
  };
}

export const subscriptionHelper = new SubscriptionHelper();
