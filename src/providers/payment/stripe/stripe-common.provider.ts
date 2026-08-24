import envConfig from "@/config/env";
import Stripe from "stripe";
import {
  TBalanceTransactions,
  TCreateCoupon,
  TCreatePaymentIntent,
  TCreatePromotionCode,
  TListCoupons,
  TListPromotionCodes,
} from "@/providers/payment/stripe/stripe.types";

export class StripeCommonProvider {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  //-----------------------------
  // COMMON STRIPE METHODS
  //-----------------------------

  public createStripeCustomer = async (name: string, email: string) => {
    return this.stripe.customers.create({
      name,
      email,
    });
  };

  public createPaymentIntent = async ({
    amount,
    currency,
    customerId,
  }: TCreatePaymentIntent) => {
    try {
      return this.stripe.paymentIntents.create({
        amount,
        currency,
        customer: customerId,

        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (error) {
      console.error("Error creating payment intent: ", error);
      throw error;
    }
  };

  public constructEvent = async (
    body: string,
    stripeSignature: string,
    secret: string,
  ) => {
    return this.stripe.webhooks.constructEvent(body, stripeSignature, secret);
  };

  public createRefund = async (chargeId: string) => {
    try {
      return this.stripe.refunds.create({
        charge: chargeId,
      });
    } catch (error) {
      console.error("Error refunding the amount: ", error);
      throw error;
    }
  };

  public balanceTransactions = async (params: TBalanceTransactions) => {
    try {
      return this.stripe.balanceTransactions.list(params);
    } catch (error) {
      console.error("Error getting balance transactions: ", error);
      throw error;
    }
  };

  public getCustomer = async (customerId: string) => {
    return this.stripe.customers.retrieve(customerId);
  };

  //-----------------------------
  // STRIPE COUPON METHODS
  //-----------------------------

  public createCoupon = async (params: TCreateCoupon) => {
    try {
      return this.stripe.coupons.create(params);
    } catch (error) {
      console.error("Error creating coupon: ", error);
      throw error;
    }
  };

  public listCoupons = async (params: TListCoupons) => {
    try {
      return this.stripe.coupons.list(params);
    } catch (error) {
      console.error("Error getting all the coupons: ", error);
      throw error;
    }
  };

  public getCoupon = async (couponId: string) => {
    return this.stripe.coupons.retrieve(couponId);
  };

  public editCoupon = async (
    couponId: string,
    data: Partial<TCreateCoupon>,
  ) => {
    return this.stripe.coupons.update(couponId, data);
  };

  public deleteCoupon = async (couponId: string) => {
    try {
      return this.stripe.coupons.del(couponId);
    } catch (error) {
      console.error("Error deleting coupon: ", error);
      throw error;
    }
  };

  //----------------------------------
  // STRIPE PROMOTION CODE METHODS
  //----------------------------------

  public createPromotionCode = async (params: TCreatePromotionCode) => {
    try {
      return this.stripe.promotionCodes.create(params);
    } catch (error) {
      console.error("Error creating promotion code: ", error);
      throw error;
    }
  };

  public listPromotionCodes = async (params: TListPromotionCodes) => {
    try {
      return this.stripe.promotionCodes.list(params);
    } catch (error) {
      console.error("Error listing promotion codes: ", error);
      throw error;
    }
  };

  //----------------------------------
  // INVOICE & PAYMENT INTENT METHODS
  //----------------------------------

  public retrieveInvoice = async (
    invoiceId: string,
  ): Promise<Stripe.Invoice> => {
    try {
      return await this.stripe.invoices.retrieve(invoiceId);
    } catch (error) {
      console.error("Error retrieving invoice: ", error);
      throw error;
    }
  };

  public retrievePaymentIntent = async (
    paymentIntentId: string,
  ): Promise<Stripe.PaymentIntent> => {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      console.error("Error retrieving payment intent: ", error);
      throw error;
    }
  };

  public updatePromotionCode = async (
    promotionCodeId: string,
    params: Partial<TCreatePromotionCode>,
  ) => {
    try {
      return this.stripe.promotionCodes.update(promotionCodeId, params);
    } catch (error) {
      console.error("Error deleting promotion code: ", error);
      throw error;
    }
  };

  /**
   * Used only by local E2E test-account cleanup.
   * This is not the application's normal soft-delete flow.
   */
  public deleteStripeCustomer = async (customerId: string) => {
    return this.stripe.customers.del(customerId);
  };
}
