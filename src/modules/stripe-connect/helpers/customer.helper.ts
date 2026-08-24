import { StripeConnectCustomer } from "@/db/models/stripeConnect/customer";
import {
  TCreateCustomer,
  TUpdateCustomer,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TObjectId } from "@/types/common.types";

/**
 * Create a new customer
 */
export async function createCustomer({
  userRef,
  stripeCustomerId,
  companyRef,
}: TCreateCustomer) {
  return StripeConnectCustomer.create({
    userRef,
    stripeCustomerId,
    companyRef,
  });
}

/**
 * Update customer details
 */
export async function updateCustomer({ userRef, update }: TUpdateCustomer) {
  return StripeConnectCustomer.findOneAndUpdate({ userRef }, update);
}

/**
 * Get customer by user reference
 */
export async function getCustomer(userRef: TObjectId) {
  return StripeConnectCustomer.findOne({ userRef });
}
