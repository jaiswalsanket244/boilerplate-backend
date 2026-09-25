import { describe, expect, it } from "vitest";
import {
  canRetry,
  MAX_RETRIES,
  RETRY_DELAY_MS,
} from "@/modules/stripe-payment/helpers/payment-retry.helper";

describe("payment-retry.helper", () => {
  it("caps retries at 3", () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it("sets retry delay to 10 minutes in milliseconds", () => {
    expect(RETRY_DELAY_MS).toBe(10 * 60 * 1_000);
  });

  it("allows retry when count is below the limit", () => {
    expect(canRetry(0)).toBe(true);
    expect(canRetry(1)).toBe(true);
    expect(canRetry(2)).toBe(true);
  });

  it("blocks retry when count reaches the limit", () => {
    expect(canRetry(3)).toBe(false);
    expect(canRetry(4)).toBe(false);
  });
});
