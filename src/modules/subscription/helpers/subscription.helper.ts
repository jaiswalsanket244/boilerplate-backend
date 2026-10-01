import { ISubscriptionDocument, Subscription } from "@/db/models/subscription";
import { FilterQuery } from "mongoose";
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
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";

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
   * Find a company's subscriptions that Stripe can still bill
   */
  findBillableCompanySubscriptions = async (
    companyRef: TObjectId,
    filter: FilterQuery<ISubscriptionDocument> = {},
  ) => {
    // The webhook creates one row per Stripe subscription with the buyer's
    // companyRef, so a company can hold several; callers must act on all.
    return Subscription.find({
      companyRef,
      status: {
        $in: [
          STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
          STRIPE_SUBSCRIPTION_STATUS.PAST_DUE,
        ],
      },
      stripeSubscriptionId: { $exists: true, $nin: [null, ""] },
      ...filter,
    });
  };

  /**
   * Cancel at period end every billable subscription of a deactivated company
   */
  cancelCompanySubscriptionsAtPeriodEnd = async (companyRef: TObjectId) => {
    const subscriptions =
      await this.findBillableCompanySubscriptions(companyRef);

    for (const subscription of subscriptions) {
      // Already ending at period end because the customer cancelled; leave the
      // row unflagged so reactivation does not revive what they cancelled.
      if (subscription.subscriptionCancellationRequested) continue;

      try {
        await paymentGateway.cancelSubscription(
          subscription.stripeSubscriptionId!,
        );
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            subscriptionCancellationRequested: true,
            cancelledByCompanyDeactivation: true,
          },
        );
      } catch (error) {
        // Swallowed on purpose: the company must still be deactivated even if
        // Stripe fails, and rolling back would leave a blocked company billed.
        // Logged per subscription so it can be cancelled by hand.
        console.error(
          `Failed to cancel subscription ${subscription.stripeSubscriptionId} for deactivated company ${companyRef}:`,
          error,
        );
      }
    }
  };

  /**
   * Undo the cancellations made by deactivating a company that is reactivated
   */
  undoCompanySubscriptionCancellations = async (companyRef: TObjectId) => {
    // Subscriptions whose period already ended were marked INACTIVE by the
    // customer.subscription.deleted webhook, so they are not billable and are skipped.
    const subscriptions = await this.findBillableCompanySubscriptions(
      companyRef,
      { cancelledByCompanyDeactivation: true },
    );

    for (const subscription of subscriptions) {
      try {
        await paymentGateway.undoCancelSubscription(
          subscription.stripeSubscriptionId!,
        );
        await Subscription.updateOne(
          { _id: subscription._id },
          {
            subscriptionCancellationRequested: false,
            cancelledByCompanyDeactivation: false,
          },
        );
      } catch (error) {
        // Swallowed on purpose: reactivation must still succeed. Stripe rejects
        // this when the subscription ended before the webhook reached us; the
        // company then re-subscribes through the normal flow.
        console.error(
          `Failed to undo cancellation of subscription ${subscription.stripeSubscriptionId} for reactivated company ${companyRef}:`,
          error,
        );
      }
    }
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
