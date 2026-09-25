import { describe, expect, it } from "vitest";
import {
  MAX_RETRIES,
  RETRY_DELAY_MS,
  canRetry,
} from "@/modules/stripe-payment/helpers/payment-retry.helper";

describe("payment-retry constants", () => {
  it("MAX_RETRIES is 3", () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it("RETRY_DELAY_MS is 10 minutes (600 000 ms)", () => {
    expect(RETRY_DELAY_MS).toBe(10 * 60 * 1_000);
  });
});

describe("canRetry", () => {
  it("allows retry when attempt count is below the limit", () => {
    expect(canRetry(0)).toBe(true);
    expect(canRetry(1)).toBe(true);
    expect(canRetry(2)).toBe(true);
  });

  it("blocks retry once the limit is reached", () => {
    expect(canRetry(3)).toBe(false);
    expect(canRetry(4)).toBe(false);
  });
});
