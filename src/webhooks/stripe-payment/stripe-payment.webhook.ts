import { Request, Response, NextFunction } from "express";
import { StripePaymentTransactions } from "@/db/models/stripePayment/transactions";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import status from "http-status";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { paymentGateway } from "@/providers/payment";
import envConfig from "@/config/env";

export class StripePaymentWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      // Retrieve the event by verifying the signature using the raw body and secret.
      let event: any;
      try {
        event = await paymentGateway.verifyWebhookEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          envConfig.STRIPE_PAYMENT_WEBHOOK_SECRET,
        );
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      switch (event.type) {
        case "checkout.session.completed":
          {
            const checkoutSession = event.data.object;
            if (checkoutSession.id && checkoutSession.payment_intent) {
              try {
                await StripePaymentTransactions.findOneAndUpdate(
                  {
                    stripeCheckoutSessionId: checkoutSession.id,
                  },
                  {
                    stripePaymentIntentId: checkoutSession.payment_intent,
                    paymentStatus: PAYMENT_STATUS.PAID,
                    orderPlacedAt: Date.now(),
                    amountPaid: checkoutSession.amount_total / 100, // convert cents to dollars
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
        case "charge.updated":
          {
            const charge = event.data.object;
            if (charge.payment_intent) {
              try {
                await StripePaymentTransactions.findOneAndUpdate(
                  {
                    stripePaymentIntentId: charge.payment_intent,
                  },
                  {
                    stripeChargeId: charge.id,
                  },
                );
              } catch (error) {
                return ErrorResponse(res, status.BAD_REQUEST, {
                  message: "Error storing the payment Intent Id in payment DB",
                  errors: error,
                });
              }
            }
          }
          break;
        case "charge.refunded":
          {
            const charge = event.data.object;
            if (charge.id) {
              try {
                await StripePaymentTransactions.findOneAndUpdate(
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
        message: "Operation successful",
      });
    } catch (error) {
      next(error);
    }
  }
}
