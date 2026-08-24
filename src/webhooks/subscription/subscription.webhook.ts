import envConfig from "@/config/env";
import { Company } from "@/db/models/company";
import { Subscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import { paymentGateway } from "@/providers/payment";
import {
  sendNewSubscriptionEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionRenewalFailedEmail,
} from "@/webhooks/subscription/subscription-email.helper";
import { NextFunction, Request, Response } from "express";
import status from "http-status";

const enum SUBSCRIPTION_PLAN {
  UNNAMED_PLAN = "Unnamed Plan",
}

export class SubscriptionWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      let event: any;

      try {
        event = await paymentGateway.verifyWebhookEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          envConfig.STRIPE_WEBHOOK_SECRET,
        );
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      const user = await User.findOne({
        stripeCustomerId: event.data.object.customer,
      });

      let email;
      if (user) {
        switch (event.type) {
          case "customer.subscription.updated":
            try {
              if (event.data.object?.cancel_at_period_end) {
                await sendSubscriptionCancelledEmail({
                  email: user.email,
                  fullName: user.fullName,
                });
              } else if (event.data.object.status === "active") {
                const subscriptionEvent = event.data.object;

                // Check if subscription already exists
                const existingSubscription = await Subscription.findOne({
                  stripeSubscriptionId: subscriptionEvent.id,
                });

                let response;
                if (existingSubscription) {
                  // Update existing subscription
                  await Subscription.updateOne(
                    { stripeSubscriptionId: subscriptionEvent.id },
                    {
                      $set: {
                        price: subscriptionEvent.plan.amount,
                        planId: subscriptionEvent.plan.id,
                        planName:
                          subscriptionEvent.plan.nickname ||
                          SUBSCRIPTION_PLAN.UNNAMED_PLAN,
                        currentPeriodStarts:
                          subscriptionEvent?.items?.data[0]
                            ?.current_period_start,
                        currentPeriodEnds:
                          subscriptionEvent?.items?.data[0]?.current_period_end,
                        productId:
                          subscriptionEvent?.items?.data[0]?.plan?.product,
                        period:
                          subscriptionEvent?.items?.data[0]?.plan?.interval,
                        status: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
                      },
                    },
                  );
                  response = existingSubscription;
                } else {
                  // Create new subscription
                  try {
                    response = await Subscription.create({
                      userRef: user._id,
                      companyRef: user.companyRef?._id,
                      price: subscriptionEvent.plan.amount,
                      stripeCustomerId: subscriptionEvent.customer,
                      stripeSubscriptionId: subscriptionEvent.id,
                      status: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
                      planId: subscriptionEvent.plan.id,
                      planName:
                        subscriptionEvent.plan.nickname ||
                        SUBSCRIPTION_PLAN.UNNAMED_PLAN,
                      currentPeriodStarts:
                        subscriptionEvent?.items?.data[0]?.current_period_start,
                      currentPeriodEnds:
                        subscriptionEvent?.items?.data[0]?.current_period_end,
                      productId:
                        subscriptionEvent?.items?.data[0]?.plan?.product,
                      period: subscriptionEvent?.items?.data[0]?.plan?.interval,
                    });
                  } catch (error) {
                    return ErrorResponse(res, status.BAD_REQUEST, {
                      message: "Subscription Creation error",
                      errors: error,
                    });
                  }
                }

                //add the subscription id to user
                await Company.updateOne(
                  { name: user.email },
                  {
                    $set: {
                      subscriptionRef: response._id,
                    },
                  },
                );

                // Send success email

                await sendNewSubscriptionEmail({
                  email: user.email,
                  fullName: user.fullName,
                });
              }
            } catch (error) {
              return ErrorResponse(res, status.BAD_REQUEST, {
                message: "Subscription Updation Error",
                errors: error,
              });
            }
            break;
          case "customer.subscription.deleted":
            try {
              if (event.data.object?.cancel_at_period_end) {
                await Subscription.updateOne(
                  { stripeSubscriptionId: event.data.object.id },
                  { $set: { status: STRIPE_SUBSCRIPTION_STATUS.INACTIVE } },
                );
                //remove the subscription id from user
                await Company.updateOne(
                  { name: user.email },
                  {
                    $set: {
                      subscriptionRef: null,
                    },
                  },
                );
              }
            } catch (error) {
              return ErrorResponse(res, status.BAD_REQUEST, {
                message: "Subscription Updation Error",
                errors: error,
              });
            }
            break;
          case "invoice.payment_failed":
            try {
              const invoice = await paymentGateway.retrieveInvoice(
                event.data.object.id,
              );
              const paymentIntentId = invoice.payment_intent;
              if (invoice.billing_reason != "subscription_create") {
                await Subscription.updateOne(
                  { stripeSubscriptionId: invoice.subscription },
                  { $set: { status: STRIPE_SUBSCRIPTION_STATUS.PAST_DUE } },
                );
                if (paymentIntentId) {
                  await paymentGateway.retrievePaymentIntent(
                    String(paymentIntentId),
                  );

                  await sendSubscriptionRenewalFailedEmail({
                    email: user.email,
                    fullName: user.fullName,
                  });
                }
              }
            } catch (error) {
              return ErrorResponse(res, status.BAD_REQUEST, {
                message: "Payment Failed Error",
                errors: error,
              });
            }
            break;
        }
      }
      return SuccessResponse(res, status.OK, {
        message: "Subscription created successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
}
