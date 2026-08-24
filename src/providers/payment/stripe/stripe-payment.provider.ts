import envConfig from "@/config/env";
import Stripe from "stripe";
import { TCreateCheckoutSession } from "@/modules/stripe-payment/utils/stripe-payment.types";

export class StripePaymentProvider {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  public constructEvent = async (body: string, stripeSignature: string) => {
    return this.stripe.webhooks.constructEvent(
      body,
      stripeSignature,
      envConfig.STRIPE_PAYMENT_WEBHOOK_SECRET,
    );
  };

  public createCheckoutSession = async (params: TCreateCheckoutSession) => {
    try {
      return this.stripe.checkout.sessions.create(params);
    } catch (error) {
      console.error("Error creating checkout session: ", error);
      throw error;
    }
  };

  public retrieveCheckoutSession = async (sessionId: string) => {
    try {
      return this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      console.error("Error retrieving checkout session: ", error);
      throw error;
    }
  };
}
