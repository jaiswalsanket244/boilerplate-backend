import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { NextFunction, Request, Response } from "express";
import status from "http-status";
import envConfig from "@/config/env";

export class StripeConnectWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      // Retrieve the event by verifying the signature using the raw body and secret.
      let event: any;
      try {
        event = await paymentGateway.verifyWebhookEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          envConfig.STRIPE_CONNECT_WEBHOOK_SECRET,
        );
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      switch (event.type) {
        case "payment_intent.succeeded":
          {
            const paymentIntent = event.data.object;
            if (paymentIntent && paymentIntent.id) {
              try {
                await StripeConnectTransactions.findOneAndUpdate(
                  {
                    stripePaymentIntentId: paymentIntent.id,
                  },
                  {
                    paymentStatus: PAYMENT_STATUS.PAID,
                    orderPlacedAt: Date.now(),
                  },
                );
              } catch (error) {
                return ErrorResponse(res, status.BAD_REQUEST, {
                  message:
                    "Error storing the payment Intent Id in transactions DB",
                  errors: error,
                });
              }
            }
          }
          break;
        case "charge.succeeded":
          {
            const charge = event.data.object;
            if (charge && charge.payment_intent) {
              try {
                // ------------------
                // normal flow
                // ------------------
                const transactionUpdateObj: {
                  stripeChargeId: string;
                } = { stripeChargeId: charge.id };

                await StripeConnectTransactions.findOneAndUpdate(
                  {
                    stripePaymentIntentId: charge.payment_intent,
                  },
                  {
                    ...transactionUpdateObj,
                  },
                );
              } catch (error) {
                return ErrorResponse(res, status.BAD_REQUEST, {
                  message:
                    "Error storing the payment Intent Id in transactions DB",
                  errors: error,
                });
              }
            }
          }
          break;
        case "charge.refunded":
          {
            const charge = event.data.object;
            if (charge && charge.id) {
              try {
                await StripeConnectTransactions.findOneAndUpdate(
                  {
                    stripeChargeId: charge.id,
                  },
                  {
                    refunded: true,
                  },
                );
              } catch (error) {
                return ErrorResponse(res, status.BAD_REQUEST, {
                  message: "Error storing the charge Id in transactions DB",
                  errors: error,
                });
              }
            }
          }
          break;
      }

      return SuccessResponse(res, status.OK, {
        message: "Operation successfull",
      });
    } catch (error) {
      next(error);
    }
  }
}
