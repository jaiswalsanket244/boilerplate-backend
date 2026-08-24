export const STRIPE_PAYMENT_MESSAGES = {
  SUCCESS: "Success",
  PRODUCT_NOT_FOUND: "Product not found",
  ORDER_NOT_FOUND: "Order not found",
  ORDER_ALREADY_REFUNDED: "Order is already refunded",
  CUSTOMER_ALREADY_EXISTS: "Customer already exists",
  CANT_BE_REFUNDED: "Can't be refunded",
  SESSION_EXPIRED: "Session has expired",
} as const;

export const REFUND_PERIOD = {
  ELIGIBILITY_DAYS: 10,
} as const;
