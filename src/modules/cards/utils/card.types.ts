import Stripe from "stripe";
import { cardValidators } from "@/modules/cards/utils/card.validation";

// Controller types
export type TCardController = typeof cardValidators;

// A Stripe PaymentMethod enriched with derived, frontend-facing wallet fields.
// walletType: the wallet provider (e.g. "google_pay"), null for direct cards.
// displayLast4: the underlying digits to show — wallet.dynamic_last4 for wallet
// cards, otherwise card.last4.
export type TCardWithDisplay = Stripe.PaymentMethod & {
  walletType: string | null;
  displayLast4: string | null;
};
