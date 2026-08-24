import {
  TCreateCustomer,
  TCreateProduct,
  TCreateTransaction,
  TCreateVendor,
  TFindAllProductsParams,
  TGetAllOrdersOptions,
  TGetAllTransactions,
  TGetTransactionDetails,
  TIncrementAmountOwed,
  TUpdateCustomer,
  TUpdateTransaction,
  TUpdateVendor,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TObjectId } from "@/types/common.types";
import { DURATION } from "@/modules/stripe-connect/utils/stripe-connect.enum";

import * as ProductHelper from "@/modules/stripe-connect/helpers/products.helper";
import * as CustomerHelper from "@/modules/stripe-connect/helpers/customer.helper";
import * as VendorHelper from "@/modules/stripe-connect/helpers/vendor.helper";
import * as TransactionHelper from "@/modules/stripe-connect/helpers/transaction.helper";
import * as EarningsHelper from "@/modules/stripe-connect/helpers/earnings.helper";
import { FilterQuery } from "mongoose";
import { IVendorDocument } from "@/db/models/stripeConnect/vendor";

class StripeConnectHelper {
  // ==================== Product Methods ====================

  async findAllProducts(params: TFindAllProductsParams) {
    return ProductHelper.findAllProducts(params);
  }

  async findOneProduct(productId: TObjectId) {
    return ProductHelper.findOneProduct(productId);
  }

  async createProduct(productDetails: TCreateProduct) {
    return ProductHelper.createProduct(productDetails);
  }

  async editProduct(
    productId: string,
    productDetails: Partial<TCreateProduct>,
  ) {
    return ProductHelper.editProduct(productId, productDetails);
  }

  async deleteProduct(id: string, companyRef: string) {
    return ProductHelper.deleteProduct(id, companyRef);
  }

  // ==================== Customer Methods ====================

  async createCustomer(data: TCreateCustomer) {
    return CustomerHelper.createCustomer(data);
  }

  async updateCustomer(data: TUpdateCustomer) {
    return CustomerHelper.updateCustomer(data);
  }

  async getCustomer(userRef: TObjectId) {
    return CustomerHelper.getCustomer(userRef);
  }

  // ==================== Vendor Methods ====================

  async updateVendor(data: TUpdateVendor) {
    return VendorHelper.updateVendor(data);
  }

  async incrementAmountOwed(data: TIncrementAmountOwed) {
    return VendorHelper.incrementAmountOwed(data);
  }

  async getVendor(condition: FilterQuery<IVendorDocument>) {
    return VendorHelper.getVendor(condition);
  }

  async updateVendorByAccountId(data: TUpdateVendor) {
    return VendorHelper.updateVendorByAccountId(data);
  }

  async createVendor(data: TCreateVendor) {
    return VendorHelper.createVendor(data);
  }

  async getAllVendors(query: {
    page?: number;
    pageSize?: number;
    searchValue?: string;
  }) {
    return VendorHelper.getAllVendors(query);
  }

  // ==================== Transaction Methods ====================

  async findOneOrder(id: TObjectId) {
    return TransactionHelper.findOneOrder(id);
  }

  async updateTransaction(data: TUpdateTransaction) {
    return TransactionHelper.updateTransaction(data);
  }

  async createTransaction(data: TCreateTransaction) {
    return TransactionHelper.createTransaction(data);
  }

  async getAllOrders(stripeCustomerId: string, options: TGetAllOrdersOptions) {
    return TransactionHelper.getAllOrders(stripeCustomerId, options);
  }

  async getAllOrdersCount(stripeCustomerId: string) {
    return TransactionHelper.getAllOrdersCount(stripeCustomerId);
  }

  async getAllTransactions(query: TGetAllTransactions) {
    return TransactionHelper.getAllTransactions(query);
  }

  async updateTransactionById(data: TUpdateTransaction) {
    return TransactionHelper.updateTransactionById(data);
  }

  async getTransactionDetails(options: TGetTransactionDetails) {
    return TransactionHelper.getTransactionDetails(options);
  }

  async countTransactionByStatus(companyRef: string) {
    return TransactionHelper.countTransactionByStatus(companyRef);
  }

  async getSuperAdminTransactions(options: Partial<TGetTransactionDetails>) {
    return TransactionHelper.getSuperAdminTransactions(options);
  }

  async countSuperAdminTransactions() {
    return TransactionHelper.countSuperAdminTransactions();
  }

  // ==================== Earnings Methods ====================

  calculateNetAmount(grossAmount: number): number {
    return EarningsHelper.calculateNetAmount(grossAmount);
  }

  async getEarningDetails(stripeAccountId: string) {
    return EarningsHelper.getEarningDetails(stripeAccountId);
  }

  async getEarningsByType(stripeAccountId: string, type: DURATION) {
    return EarningsHelper.getEarningsByType(stripeAccountId, type);
  }
}

export const stripeConnectHelper = new StripeConnectHelper();
