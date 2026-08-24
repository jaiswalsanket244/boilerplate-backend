import { stripeConnectHelper } from "@/modules/stripe-connect/helpers/stripe-connect.helper";
import { paymentGateway } from "@/providers/payment";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import {
  buildSearchFilter,
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import {
  CURRENCY,
  PAYMENT_STATUS,
} from "@/providers/payment/stripe/stripe.types";
import status from "http-status";
import { TStripeConnectController } from "@/modules/stripe-connect/utils/stripe-connect.types";
import {
  REFUND_ELIGIBILITY_DAYS,
  STRIPE_CONNECT_MESSAGES,
} from "@/modules/stripe-connect/utils/stripe-connect.constant";

/**
 * StripeConnectController class for handling Stripe Connect related HTTP requests
 */
export class StripeConnectController {
  /**
   * Get products with pagination and filtering
   */
  product: TStripeConnectController["product"] = async (req, res, next) => {
    try {
      const user = req.user!;
      const { query } = req;
      const searchValue = query.search;
      const { page, pageSize } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );

      const { filters, sorting } = parseQueryString(req.query);

      const mongoFilter = getMongoFilter({
        filters,
        searchColumns: ["title"],
        searchValue: searchValue,
      });

      const mongoSort = getMongoSort(sorting);

      const companyRef = user.companyRef!;

      const data = await stripeConnectHelper.findAllProducts({
        companyRef: companyRef?._id || companyRef,
        filters: mongoFilter,
        sorting: mongoSort,
        page,
        pageSize,
      });
      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create payment intent for a product
   */
  createPaymentIntent: TStripeConnectController["createPaymentIntent"] = async (
    req,
    res,
    next,
  ) => {
    try {
      // get product details using productId.
      const { productId } = req.body;
      const productData = await stripeConnectHelper.findOneProduct(
        ObjectId(productId),
      );

      if (!productData) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: STRIPE_CONNECT_MESSAGES.PRODUCT_NOT_FOUND,
        });
      }

      const user = req.user!;
      const userRef = user._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);

      // if user doesnt have stripe customer account then create one.
      let customerId = customerData?.stripeCustomerId || null;
      if (!customerData) {
        const name = `${user.name.first} ${user.name.last}`;
        const email = user.email;
        const newCustomer = await paymentGateway.createCustomer(name, email);
        customerId = newCustomer.id;

        await stripeConnectHelper.createCustomer({
          userRef,
          stripeCustomerId: customerId,
          companyRef: user.companyRef!,
        });
      }

      // set currency to `usd`.
      const paymentIntent = await paymentGateway.createPaymentIntent({
        amount: (productData.price as number) * 100, // convert cents to dollar
        currency: CURRENCY.USD,
        customerId: customerId!,
      });

      await stripeConnectHelper.createTransaction({
        stripeAccountId: productData.stripeAccountId,
        stripeCustomerId: customerId!,
        stripePaymentIntentId: paymentIntent.id,
        productRef: productData._id,
        amountPaid: productData.price as number,
        companyRef: productData.companyRef,
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create a Stripe customer
   */
  createCustomer: TStripeConnectController["createCustomer"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const userRef = user._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);

      if (customerData) {
        return ErrorResponse(res, status.UNPROCESSABLE_ENTITY, {
          message: STRIPE_CONNECT_MESSAGES.CUSTOMER_ALREADY_EXISTS,
        });
      }

      // if user doesnt have stripe customer account then create one.
      let customerId = null;
      const name = `${user.name.first} ${user.name.last}`;
      const email = user.email;
      const newCustomer = await paymentGateway.createCustomer(name, email);
      customerId = newCustomer.id;

      await stripeConnectHelper.createCustomer({
        userRef,
        stripeCustomerId: customerId,
        companyRef: user.companyRef!,
      });

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: {
          stripeCustomerId: customerId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get customer details
   */
  getCustomer: TStripeConnectController["getCustomer"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: {
          stripeCustomerId: customerData?.stripeCustomerId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get past orders with pagination and filtering
   */
  pastOrders: TStripeConnectController["pastOrders"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);
      const stripeCustomerId = customerData?.stripeCustomerId;

      if (!stripeCustomerId) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: [],
        });
      }

      const query = req.query;
      const searchValue = query.search;

      const { page, pageSize, skips } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );

      const queryCopy = { ...query };
      delete queryCopy.search;
      delete queryCopy.page;
      delete queryCopy.pageSize;

      const { filters, sorting } = parseQueryString(queryCopy);

      const mongoFilter = getMongoFilter({
        filters,
      });

      const mongoSort = getMongoSort(sorting);
      const searchFilter = buildSearchFilter(searchValue, [
        "productDetails.title",
      ]);

      const transactions = await stripeConnectHelper.getAllOrders(
        stripeCustomerId,
        {
          page,
          pageSize,
          skips,
          filters: mongoFilter,
          sorting: mongoSort,
          searchFilter,
        },
      );

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: transactions,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get count of past orders
   */
  pastOrdersCount: TStripeConnectController["pastOrdersCount"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const customerData = await stripeConnectHelper.getCustomer(userRef);
      const stripeCustomerId = customerData?.stripeCustomerId;

      if (!stripeCustomerId) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.SUCCESS,
          data: [],
        });
      }

      const count =
        await stripeConnectHelper.getAllOrdersCount(stripeCustomerId);

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
        data: count,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Refund an order
   */
  refundOrder: TStripeConnectController["refundOrder"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const stripeTransactionId = req.params.id;
      const transactionDetails = await stripeConnectHelper.findOneOrder(
        ObjectId(stripeTransactionId),
      );

      if (!transactionDetails || !transactionDetails?.isRefundable) {
        return SuccessResponse(res, status.OK, {
          message: STRIPE_CONNECT_MESSAGES.CANT_BE_REFUNDED,
        });
      }

      const orderDate = new Date(transactionDetails.orderPlacedAt!).getTime();
      const currentDate = new Date().getTime();

      // diff in milliseconds
      const differenceInMs = currentDate - orderDate;

      // Convert milliseconds to days
      const daysPassed = Math.floor(differenceInMs / (1000 * 60 * 60 * 24));
      const isRefundable = daysPassed > REFUND_ELIGIBILITY_DAYS ? false : true;

      if (isRefundable && !transactionDetails.refunded) {
        const chargeId = transactionDetails.stripeChargeId;

        await paymentGateway.createRefund(chargeId!);
        await stripeConnectHelper.updateTransaction({
          id: ObjectId(stripeTransactionId),
          update: {
            isRefundable: !isRefundable,
            paymentStatus: PAYMENT_STATUS.REFUNDED,
            refunded: true,
          },
        });
      }

      return SuccessResponse(res, status.OK, {
        message: STRIPE_CONNECT_MESSAGES.SUCCESS,
      });
    } catch (error) {
      next(error);
    }
  };
}
