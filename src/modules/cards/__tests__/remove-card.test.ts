// Tests the DELETE /api/admin/cards/:paymentMethodId endpoint. Stripe is mocked
// so no live calls are made; only paymentMethods.retrieve/detach are exercised.
import { createApp } from "@/app";
import { USER_TYPE } from "@/enums";
import { CARD_MESSAGES } from "@/modules/cards/utils/card.constant";
import { createTestSession } from "@/tests/utils/auth";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieveMock, detachMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  detachMock: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    paymentMethods = { retrieve: retrieveMock, detach: detachMock };
  },
}));

const CUSTOMER_ID = "cus_test123";
const PAYMENT_METHOD_ID = "pm_test123";

describe("DELETE /api/admin/cards/:paymentMethodId", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("success", () => {
    it("detaches the card and returns 200", async () => {
      retrieveMock.mockResolvedValue({ customer: CUSTOMER_ID });
      detachMock.mockResolvedValue({ id: PAYMENT_METHOD_ID });

      const session = await createTestSession(USER_TYPE.USER, {
        stripeCustomerId: CUSTOMER_ID,
      });

      const res = await request(app)
        .delete(`/api/admin/cards/${PAYMENT_METHOD_ID}`)
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(CARD_MESSAGES.CARD_REMOVED_SUCCESS);
      expect(detachMock).toHaveBeenCalledWith(PAYMENT_METHOD_ID);
    });

    it("removes the current default card without throwing", async () => {
      // Stripe clears the default automatically on detach, so a default card
      // detaches like any other and must still return 200.
      retrieveMock.mockResolvedValue({ customer: CUSTOMER_ID });
      detachMock.mockResolvedValue({ id: PAYMENT_METHOD_ID });

      const session = await createTestSession(USER_TYPE.USER, {
        stripeCustomerId: CUSTOMER_ID,
      });

      const res = await request(app)
        .delete(`/api/admin/cards/${PAYMENT_METHOD_ID}`)
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(detachMock).toHaveBeenCalledWith(PAYMENT_METHOD_ID);
    });
  });

  describe("auth errors", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .delete(`/api/admin/cards/${PAYMENT_METHOD_ID}`)
        .set("Accept", "application/json");

      expect(res.status).toBe(401);
      expect(detachMock).not.toHaveBeenCalled();
    });

    it("returns 400 when the user has no stripeCustomerId", async () => {
      const session = await createTestSession(USER_TYPE.USER);

      const res = await request(app)
        .delete(`/api/admin/cards/${PAYMENT_METHOD_ID}`)
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(CARD_MESSAGES.STRIPE_CUSTOMER_ID_NOT_FOUND);
      expect(detachMock).not.toHaveBeenCalled();
    });
  });

  describe("ownership enforcement", () => {
    it("returns 404 and does NOT detach a card owned by another customer", async () => {
      retrieveMock.mockResolvedValue({ customer: "cus_someone_else" });

      const session = await createTestSession(USER_TYPE.USER, {
        stripeCustomerId: CUSTOMER_ID,
      });

      const res = await request(app)
        .delete(`/api/admin/cards/${PAYMENT_METHOD_ID}`)
        .set("Cookie", session.cookie)
        .set("Accept", "application/json");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(CARD_MESSAGES.CARD_NOT_FOUND);
      expect(detachMock).not.toHaveBeenCalled();
    });
  });
});
