import { paymentGateway } from "@/providers/payment";
import Stripe from "stripe";
import { SUBSCRIPTION_STATUS } from "@/modules/cards/utils/card.enum";
import envConfig from "@/config/env";

class CardHelper {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }
  /**
   * List all cards for a customer
   */
  listCards = async (customerId: string) => {
    // return CardService.listCards(customerId);
    return this.stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });
  };

  /**
   * Get customer details from Stripe
   */
  getCustomer = async (customerId: string) => {
    return paymentGateway.getCustomer(customerId);
  };

  /**
   * Check if customer is deleted
   */
  isCustomerDeleted = (
    customerResponse: Stripe.Customer | Stripe.DeletedCustomer,
  ): boolean => {
    if (SUBSCRIPTION_STATUS.DELETED in customerResponse) {
      return customerResponse.deleted === true;
    }
    return false;
  };

  /**
   * Get default payment method ID from customer
   */
  getDefaultPaymentMethodId = (
    customer: Stripe.Customer,
  ): string | null | undefined => {
    return customer.invoice_settings?.default_payment_method as
      | string
      | null
      | undefined;
  };

  /**
   * Create a setup intent for adding a new card
   */
  createSetupIntent = async (customerId: string) => {
    return this.stripe.setupIntents.create({ customer: customerId });
  };

  /**
   * Set default card for a customer
   */
  setDefaultCard = async (
    customerId: string,
    paymentMethodId: string | undefined,
  ) => {
    return this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  };
}

export const cardHelper = new CardHelper();
