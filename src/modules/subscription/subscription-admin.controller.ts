import { NextFunction, Request, Response } from "express";
import { Subscription } from "@/db/models/subscription";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";
import { SUBSCRIPTION_MESSAGES } from "@/modules/subscription/utils/subscription.constant";
import { TSubscriptionController } from "@/modules/subscription/utils/subscription.types";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import status from "http-status";

/**
 * SubscriptionAdminController class for handling admin subscription-related HTTP requests
 */
export class SubscriptionAdminController {
  /**
   * Get all Stripe subscription plans
   */
  getAllStripeSubscriptionPlans = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await subscriptionHelper.findAllSubscriptionPlans();

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.FETCHED_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get user plans
   */
  getUserPlans = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const companyId = user.companyRef!;

      const plans = await subscriptionHelper.findUserPlans(companyId);

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.USER_PLANS_SUCCESS,
        data: plans,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a Stripe customer
   */
  createStripeCustomer = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user!;
      const data = await subscriptionHelper.createStripeCustomer(user);

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.CUSTOMER_CREATED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a new subscription
   */
  createSubscription: TSubscriptionController["createSubscription"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { priceId } = req.body;
      const user = req.user!;

      // Checking if stripe customer Id is created or not => If not then create one
      const userData = await subscriptionHelper.createStripeCustomer(user);
      const stripeCustomerId = userData!.stripeCustomerId;

      if (!stripeCustomerId) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Stripe customer ID not found.",
        });
      }

      // Fetch and delete existing subscriptions (if any)
      await paymentGateway.cleanupIncompleteSubscriptions(stripeCustomerId);

      // Create new subscription
      const { subscriptionId, clientSecret } =
        await paymentGateway.createSubscription(stripeCustomerId, priceId);

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CREATED,
        data: {
          stripeCustomerId,
          subscriptionId,
          clientSecret,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Cancel a subscription
   */
  cancelSubscription: TSubscriptionController["cancelSubscription"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const subscriptionId: string = req.body.subId;

      try {
        await paymentGateway.cancelSubscription(subscriptionId);
      } catch {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Failed to cancel subscription",
        });
      }

      await Subscription.findOneAndUpdate(
        { userRef: user._id },
        {
          subscriptionCancellationRequested: true,
        },
      );

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CANCELLED,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Change subscription plan
   */
  changeSubscription: TSubscriptionController["changeSubscription"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { newPriceId } = req.body;
      const user = req.user!;
      const companyId = user.companyRef!;

      // Checking if stripe customer Id is created or not => If not then create one
      const userData = await subscriptionHelper.createStripeCustomer(user);
      const stripeCustomerId = userData!.stripeCustomerId;

      if (!stripeCustomerId) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Stripe customer ID not found.",
        });
      }

      // Get current subscription (if any) - free users won't have any subscription
      const currentSubscription =
        await subscriptionHelper.findUserPlans(companyId);

      // Handle different scenarios based on current subscription state
      if (!currentSubscription) {
        // User is on free plan (no active subscription) - CREATE new subscription
        const { subscriptionId, clientSecret } =
          await paymentGateway.createSubscription(stripeCustomerId, newPriceId);

        return SuccessResponse(res, status.OK, {
          message: SUBSCRIPTION_MESSAGES.UPGRADED_FROM_FREE,
          data: {
            stripeCustomerId,
            subscriptionId,
            clientSecret,
            changeType: "upgrade_from_free",
            effectiveDate: "immediate",
          },
        });
      }

      // User has an active subscription - UPDATE existing subscription
      const currentPriceId = currentSubscription.planId;
      const currentSubscriptionId = currentSubscription.stripeSubscriptionId!;

      // Check if user is trying to switch to the same plan
      if (currentPriceId === newPriceId) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: SUBSCRIPTION_MESSAGES.ALREADY_SUBSCRIBED,
        });
      }

      //function will automatically handle both upgrade and downgrade
      const result = await paymentGateway.updateSubscription(
        currentSubscriptionId,
        newPriceId,
      );

      if (result.success === false) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: result.error,
        });
      }

      return SuccessResponse(res, status.OK, {
        message: SUBSCRIPTION_MESSAGES.SUBSCRIPTION_CHANGED,
        data: {
          stripeCustomerId,
          subscriptionId: result.subscriptionId,
          clientSecret:
            "clientSecret" in result ? result.clientSecret : undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
