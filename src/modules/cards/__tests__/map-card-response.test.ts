import { describe, expect, it } from "vitest";
import Stripe from "stripe";

import { cardHelper } from "@/modules/cards/helpers/card.helper";

// Minimal builder for the fields mapCardForResponse reads; the rest of the
// Stripe PaymentMethod shape is irrelevant to the mapping so we cast.
const buildPaymentMethod = (
  card: Partial<Stripe.PaymentMethod.Card>,
): Stripe.PaymentMethod =>
  ({ id: "pm_test", type: "card", card }) as unknown as Stripe.PaymentMethod;

describe("cardHelper.mapCardForResponse", () => {
  it("uses wallet.type and wallet.dynamic_last4 for a wallet card", () => {
    const pm = buildPaymentMethod({
      last4: "4242",
      wallet: {
        type: "google_pay",
        dynamic_last4: "1234",
      } as Stripe.PaymentMethod.Card.Wallet,
    });

    const result = cardHelper.mapCardForResponse(pm);

    expect(result.walletType).toBe("google_pay");
    expect(result.displayLast4).toBe("1234");
    // Existing Stripe fields are preserved untouched.
    expect(result.card?.last4).toBe("4242");
    expect(result.id).toBe("pm_test");
  });

  it("falls back to card.last4 and null walletType for a directly-entered card", () => {
    const pm = buildPaymentMethod({ last4: "4242", wallet: null });

    const result = cardHelper.mapCardForResponse(pm);

    expect(result.walletType).toBeNull();
    expect(result.displayLast4).toBe("4242");
  });

  it("falls back to card.last4 when a wallet card has no dynamic_last4", () => {
    const pm = buildPaymentMethod({
      last4: "4242",
      wallet: {
        type: "apple_pay",
        dynamic_last4: null,
      } as Stripe.PaymentMethod.Card.Wallet,
    });

    const result = cardHelper.mapCardForResponse(pm);

    expect(result.walletType).toBe("apple_pay");
    expect(result.displayLast4).toBe("4242");
  });
});
