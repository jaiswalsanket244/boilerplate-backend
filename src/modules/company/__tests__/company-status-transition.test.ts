import { Subscription } from "@/db/models/subscription";
import { STATUS } from "@/enums";
import { companyHelper } from "@/modules/company/helpers/company.helper";
import { COMPANY_STATUS_TRANSITION } from "@/modules/company/utils/company.enum";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";
import { STRIPE_SUBSCRIPTION_STATUS } from "@/modules/subscription/utils/subscription.enum";
import { createAdminSession } from "@/tests/utils/auth";
import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

describe("company status transition groundwork", () => {
  describe("companyHelper.getStatusTransition", () => {
    it("detects ACTIVE -> INACTIVE as a deactivation", () => {
      expect(
        companyHelper.getStatusTransition(STATUS.ACTIVE, STATUS.INACTIVE),
      ).toBe(COMPANY_STATUS_TRANSITION.DEACTIVATED);
    });

    it("detects INACTIVE -> ACTIVE as a reactivation", () => {
      expect(
        companyHelper.getStatusTransition(STATUS.INACTIVE, STATUS.ACTIVE),
      ).toBe(COMPANY_STATUS_TRANSITION.REACTIVATED);
    });

    it.each([
      [STATUS.ACTIVE, STATUS.ACTIVE],
      [STATUS.INACTIVE, STATUS.INACTIVE],
      [STATUS.ACTIVE, undefined],
      [STATUS.ACTIVE, STATUS.DELETED],
      [STATUS.DELETED, STATUS.INACTIVE],
    ])("returns null for %s -> %s", (previous, next) => {
      expect(companyHelper.getStatusTransition(previous, next)).toBeNull();
    });
  });

  describe("companyHelper.updateWithPrevious", () => {
    it("returns the pre-update and post-update company", async () => {
      const { company } = await createAdminSession();

      const { previous, updated } = await companyHelper.updateWithPrevious(
        company._id.toString(),
        { companyStatus: STATUS.INACTIVE },
      );

      expect(previous?.companyStatus).toBe(STATUS.ACTIVE);
      expect(updated?.companyStatus).toBe(STATUS.INACTIVE);
    });

    it("reports a deactivation only once for repeated identical updates", async () => {
      const { company } = await createAdminSession();
      const id = company._id.toString();

      const first = await companyHelper.updateWithPrevious(id, {
        companyStatus: STATUS.INACTIVE,
      });
      const second = await companyHelper.updateWithPrevious(id, {
        companyStatus: STATUS.INACTIVE,
      });

      expect(
        companyHelper.getStatusTransition(
          first.previous?.companyStatus,
          first.updated?.companyStatus,
        ),
      ).toBe(COMPANY_STATUS_TRANSITION.DEACTIVATED);
      expect(
        companyHelper.getStatusTransition(
          second.previous?.companyStatus,
          second.updated?.companyStatus,
        ),
      ).toBeNull();
    });

    it("leaves companyStatus untouched when the update does not set it", async () => {
      const { company } = await createAdminSession();

      const { previous, updated } = await companyHelper.updateWithPrevious(
        company._id.toString(),
        { name: "Renamed company" },
      );

      expect(updated?.name).toBe("Renamed company");
      expect(
        companyHelper.getStatusTransition(
          previous?.companyStatus,
          updated?.companyStatus,
        ),
      ).toBeNull();
    });

    it("returns nulls for an unknown company", async () => {
      const result = await companyHelper.updateWithPrevious(
        new mongoose.Types.ObjectId().toString(),
        { companyStatus: STATUS.INACTIVE },
      );

      expect(result).toEqual({ previous: null, updated: null });
    });
  });

  describe("subscriptionHelper.findBillableCompanySubscriptions", () => {
    const seedSubscription = (
      companyRef: mongoose.Types.ObjectId,
      userRef: mongoose.Types.ObjectId,
      overrides: Record<string, unknown> = {},
    ) =>
      Subscription.create({
        companyRef,
        userRef,
        price: 1000,
        currentPeriodStarts: 1,
        currentPeriodEnds: 2,
        stripeSubscriptionId: `sub_${new mongoose.Types.ObjectId()}`,
        status: STRIPE_SUBSCRIPTION_STATUS.ACTIVE,
        ...overrides,
      });

    it("returns every ACTIVE and PAST_DUE Stripe subscription of the company", async () => {
      const { company, user } = await createAdminSession();
      const active = await seedSubscription(company._id, user._id);
      const pastDue = await seedSubscription(company._id, user._id, {
        status: STRIPE_SUBSCRIPTION_STATUS.PAST_DUE,
      });

      const result = await subscriptionHelper.findBillableCompanySubscriptions(
        company._id,
      );

      expect(result.map((s) => s.id).sort()).toEqual(
        [active.id, pastDue.id].sort(),
      );
    });

    it("skips inactive rows, rows without a Stripe id, and other companies", async () => {
      const { company, user } = await createAdminSession();
      await seedSubscription(company._id, user._id, {
        status: STRIPE_SUBSCRIPTION_STATUS.INACTIVE,
      });
      await seedSubscription(company._id, user._id, {
        stripeSubscriptionId: undefined,
      });
      await seedSubscription(new mongoose.Types.ObjectId(), user._id);

      const result = await subscriptionHelper.findBillableCompanySubscriptions(
        company._id,
      );

      expect(result).toEqual([]);
    });
  });
});
