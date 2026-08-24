import envConfig from "@/config/env";
import { TUpdateSubscriptionResult } from "@/providers/payment/stripe/stripe.types";
import Stripe from "stripe";

export class StripeSubscriptionProvider {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  public cancelSubscription = async (subscriptionId: string) => {
    return this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  };

  public createNewSubscription = async (
    customerId: string,
    priceId: string,
  ) => {
    try {
      // Create the subscription. Note we're expanding the Subscription's
      // latest invoice and that invoice's payment_intent
      // so we can pass it to the front end to confirm the payment
      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [
          {
            price: priceId,
          },
        ],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
        },
        expand: ["latest_invoice.payment_intent"],
      });

      if (
        typeof subscription.latest_invoice !== "string" &&
        subscription.latest_invoice?.payment_intent &&
        typeof subscription.latest_invoice.payment_intent !== "string"
      ) {
        return {
          subscriptionId: subscription.id,
          clientSecret:
            subscription.latest_invoice.payment_intent.client_secret,
        };
      }

      return {
        error: { message: "Could not retrieve client secret." },
      };
    } catch (error) {
      let message = "An error occurred creating the subscription.";
      if (error instanceof Error) {
        message = error.message;
      }
      return { error: { message } };
    }
  };

  public updateExistingSubscription = async (
    subscriptionId: string,
    newPriceId: string,
  ): Promise<TUpdateSubscriptionResult> => {
    try {
      // Get the current subscription
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);

      // Update to the new plan (handles both upgrade and downgrade)
      const updatedSubscription = await this.stripe.subscriptions.update(
        subscriptionId,
        {
          items: [
            {
              id: subscription.items.data[0].id,
              price: newPriceId,
            },
          ],
          proration_behavior: "create_prorations",
          expand: ["latest_invoice.payment_intent"],
        },
      );

      const latestInvoice = updatedSubscription.latest_invoice;

      if (typeof latestInvoice !== "string" && latestInvoice) {
        // Payment already completed
        if (latestInvoice.status === "paid") {
          return {
            success: true,
            subscriptionId: updatedSubscription.id,
            status: updatedSubscription.status,
          };
        }

        // Check payment intent status
        const paymentIntent = latestInvoice.payment_intent;
        if (typeof paymentIntent !== "string" && paymentIntent) {
          // Payment already succeeded
          if (paymentIntent.status === "succeeded") {
            return {
              success: true,
              subscriptionId: updatedSubscription.id,
              status: updatedSubscription.status,
            };
          }

          // Payment requires user action (3D Secure, etc.)
          if (paymentIntent.status === "requires_action") {
            return {
              success: true,
              subscriptionId: updatedSubscription.id,
              clientSecret: paymentIntent.client_secret!,
              status: updatedSubscription.status,
            };
          }

          if (paymentIntent.status === "requires_payment_method") {
            return {
              success: false,
              error: "Payment failed. Please update your payment method.",
            };
          }
        }
      }

      // Default success response
      return {
        success: true,
        subscriptionId: updatedSubscription.id,
        status: updatedSubscription.status,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  };

  public fetchAndDeleteExistingSubscriptions = async (customerId: string) => {
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
    });

    return await Promise.all(
      subscriptions.data.map((subscription) => {
        if (subscription.status === "incomplete") {
          this.stripe.subscriptions.cancel(subscription.id);
        }
      }),
    );
  };
}
