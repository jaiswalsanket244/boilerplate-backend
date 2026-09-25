import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/providers/payment", () => ({
  paymentGateway: {
    retrieveInvoice: vi.fn(),
    payInvoice: vi.fn(),
    disableInvoiceAutoAdvance: vi.fn(),
    cancelSubscriptionImmediately: vi.fn(),
  },
}));
vi.mock("@/agenda/agenda.service", () => ({
  agendaService: { scheduleUnique: vi.fn() },
}));

import { agendaService } from "@/agenda/agenda.service";
import {
  PAYMENT_RETRY,
  retryFailedInvoice,
  startInvoiceRetries,
} from "@/agenda/helpers/payment-retry.helper";
import { JOBS } from "@/agenda/utils/job-names.constant";
import { paymentGateway } from "@/providers/payment";

const gateway = vi.mocked(paymentGateway);
const scheduleUnique = vi.mocked(agendaService.scheduleUnique);

const INVOICE_ID = "in_123";
const SUBSCRIPTION_ID = "sub_123";
const NOW = new Date("2026-09-25T12:00:00.000Z");

const cardDeclined = () =>
  new Stripe.errors.StripeCardError({
    type: "card_error",
    message: "Your card was declined.",
  });

const openInvoice = (overrides: Partial<Stripe.Invoice> = {}) =>
  ({
    id: INVOICE_ID,
    status: "open",
    subscription: SUBSCRIPTION_ID,
    ...overrides,
  }) as Stripe.Invoice;

describe("payment retry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows 3 retries 10 minutes apart", () => {
    expect(PAYMENT_RETRY.MAX_RETRIES).toBe(3);
    expect(PAYMENT_RETRY.DELAY_MS).toBe(600_000);
  });

  describe("startInvoiceRetries", () => {
    it("disables Stripe's retries for the invoice and schedules retry 1 in 10 minutes", async () => {
      await startInvoiceRetries(INVOICE_ID);

      expect(gateway.disableInvoiceAutoAdvance).toHaveBeenCalledWith(
        INVOICE_ID,
      );
      expect(scheduleUnique).toHaveBeenCalledWith(
        new Date(NOW.getTime() + 600_000),
        JOBS.STRIPE.RETRY_FAILED_INVOICE,
        { invoiceId: INVOICE_ID, attempt: 1 },
        { "data.invoiceId": INVOICE_ID, "data.attempt": 1 },
      );
    });
  });

  describe("retryFailedInvoice", () => {
    it("stops after a successful charge", async () => {
      gateway.retrieveInvoice.mockResolvedValue(openInvoice());
      gateway.payInvoice.mockResolvedValue(
        openInvoice({ status: "paid" }) as never,
      );

      await retryFailedInvoice({ invoiceId: INVOICE_ID, attempt: 1 });

      expect(gateway.payInvoice).toHaveBeenCalledWith(INVOICE_ID);
      expect(scheduleUnique).not.toHaveBeenCalled();
      expect(gateway.cancelSubscriptionImmediately).not.toHaveBeenCalled();
    });

    it.each([1, 2])(
      "schedules the next retry when attempt %i is declined",
      async (attempt) => {
        gateway.retrieveInvoice.mockResolvedValue(openInvoice());
        gateway.payInvoice.mockRejectedValue(cardDeclined());

        await retryFailedInvoice({ invoiceId: INVOICE_ID, attempt });

        expect(scheduleUnique).toHaveBeenCalledWith(
          new Date(NOW.getTime() + 600_000),
          JOBS.STRIPE.RETRY_FAILED_INVOICE,
          { invoiceId: INVOICE_ID, attempt: attempt + 1 },
          { "data.invoiceId": INVOICE_ID, "data.attempt": attempt + 1 },
        );
        expect(gateway.cancelSubscriptionImmediately).not.toHaveBeenCalled();
      },
    );

    it("cancels the subscription when the 3rd retry is declined", async () => {
      gateway.retrieveInvoice.mockResolvedValue(openInvoice());
      gateway.payInvoice.mockRejectedValue(cardDeclined());

      await retryFailedInvoice({ invoiceId: INVOICE_ID, attempt: 3 });

      expect(scheduleUnique).not.toHaveBeenCalled();
      expect(gateway.cancelSubscriptionImmediately).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
      );
    });

    it.each(["paid", "void", "uncollectible"] as const)(
      "skips an invoice that is already %s",
      async (invoiceStatus) => {
        gateway.retrieveInvoice.mockResolvedValue(
          openInvoice({ status: invoiceStatus }),
        );

        await retryFailedInvoice({ invoiceId: INVOICE_ID, attempt: 2 });

        expect(gateway.payInvoice).not.toHaveBeenCalled();
        expect(scheduleUnique).not.toHaveBeenCalled();
        expect(gateway.cancelSubscriptionImmediately).not.toHaveBeenCalled();
      },
    );

    it("rethrows non-decline errors without using up an attempt", async () => {
      gateway.retrieveInvoice.mockResolvedValue(openInvoice());
      gateway.payInvoice.mockRejectedValue(new Error("socket hang up"));

      await expect(
        retryFailedInvoice({ invoiceId: INVOICE_ID, attempt: 3 }),
      ).rejects.toThrow("socket hang up");

      expect(scheduleUnique).not.toHaveBeenCalled();
      expect(gateway.cancelSubscriptionImmediately).not.toHaveBeenCalled();
    });
  });
});
