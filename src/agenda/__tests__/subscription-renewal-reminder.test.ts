import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

const agendaEvery = vi.hoisted(() => vi.fn());

vi.mock("@/agenda/agenda.service", () => ({
  agendaService: { every: agendaEvery },
}));

import {
  findSubscriptionsDueForRenewalReminder,
  RENEWAL_REMINDER_DAYS_BEFORE,
  sendRenewalReminder,
  sendSubscriptionRenewalReminders,
} from "@/agenda/helpers/subscription-renewal-reminder.helper";
import { registerAllJobs } from "@/agenda/register";
import { syncRecurringJobs } from "@/agenda/schedule";
import { JOBS } from "@/agenda/utils/job-names.constant";
import { Subscription } from "@/db/models/subscription";
import { STATUS } from "@/enums";

// "now" is mid-morning 2026-03-10 UTC, so the target renewal day is 2026-03-13 UTC.
const NOW = new Date("2026-03-10T09:00:00.000Z");
const toSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const createSubscription = (overrides: Record<string, unknown> = {}) =>
  Subscription.create({
    userRef: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    price: 1000,
    currentPeriodStarts: toSeconds("2026-02-13T12:00:00.000Z"),
    currentPeriodEnds: toSeconds("2026-03-13T12:00:00.000Z"),
    stripeSubscriptionId: `sub_${new mongoose.Types.ObjectId().toString()}`,
    status: STATUS.ACTIVE,
    ...overrides,
  });

const dueIds = async (now: Date = NOW) =>
  (await findSubscriptionsDueForRenewalReminder(now)).map((s) =>
    s._id.toString(),
  );

describe("findSubscriptionsDueForRenewalReminder", () => {
  it("uses a 3-day reminder window", () => {
    expect(RENEWAL_REMINDER_DAYS_BEFORE).toBe(3);
  });

  it("includes an active, non-cancelling subscription renewing exactly N days out", async () => {
    const sub = await createSubscription();

    expect(await dueIds()).toEqual([sub._id.toString()]);
  });

  it.each([STATUS.INACTIVE, STATUS.DELETED, STATUS.PAST_DUE])(
    "excludes subscriptions with status %s",
    async (status) => {
      await createSubscription({ status });

      expect(await dueIds()).toEqual([]);
    },
  );

  it("excludes subscriptions with a cancellation requested", async () => {
    await createSubscription({ subscriptionCancellationRequested: true });

    expect(await dueIds()).toEqual([]);
  });

  it("excludes subscriptions without a Stripe subscription id", async () => {
    await createSubscription({ stripeSubscriptionId: undefined });
    await createSubscription({ stripeSubscriptionId: "" });

    expect(await dueIds()).toEqual([]);
  });

  it("excludes subscriptions renewing on any other day", async () => {
    for (const iso of [
      "2026-03-11T12:00:00.000Z", // 1 day out
      "2026-03-12T12:00:00.000Z", // 2 days out
      "2026-03-14T12:00:00.000Z", // 4 days out
      "2026-03-09T12:00:00.000Z", // already past
    ]) {
      await createSubscription({ currentPeriodEnds: toSeconds(iso) });
    }

    expect(await dueIds()).toEqual([]);
  });

  it("includes both edges of the target UTC day and excludes the adjacent seconds", async () => {
    const firstSecond = await createSubscription({
      currentPeriodEnds: toSeconds("2026-03-13T00:00:00.000Z"),
    });
    const lastSecond = await createSubscription({
      currentPeriodEnds: toSeconds("2026-03-13T23:59:59.000Z"),
    });
    await createSubscription({
      currentPeriodEnds: toSeconds("2026-03-12T23:59:59.000Z"),
    });
    await createSubscription({
      currentPeriodEnds: toSeconds("2026-03-14T00:00:00.000Z"),
    });

    expect((await dueIds()).sort()).toEqual(
      [firstSecond._id.toString(), lastSecond._id.toString()].sort(),
    );
  });

  it("anchors on the UTC day of 'now' (23:59 vs 00:00 UTC)", async () => {
    const sub = await createSubscription({
      currentPeriodEnds: toSeconds("2026-03-13T12:00:00.000Z"),
    });

    expect(await dueIds(new Date("2026-03-10T00:00:00.000Z"))).toEqual([
      sub._id.toString(),
    ]);
    expect(await dueIds(new Date("2026-03-10T23:59:59.999Z"))).toEqual([
      sub._id.toString(),
    ]);
    expect(await dueIds(new Date("2026-03-09T23:59:59.999Z"))).toEqual([]);
    expect(await dueIds(new Date("2026-03-11T00:00:00.000Z"))).toEqual([]);
  });

  it("treats currentPeriodEnds as seconds, not milliseconds", async () => {
    await createSubscription({
      currentPeriodEnds: new Date("2026-03-13T12:00:00.000Z").getTime(),
    });

    expect(await dueIds()).toEqual([]);
  });
});

describe("sendSubscriptionRenewalReminders", () => {
  it("calls the hand-off once per matching subscription only", async () => {
    const a = await createSubscription();
    const b = await createSubscription();
    await createSubscription({ status: STATUS.INACTIVE });
    const sendReminder = vi.fn().mockResolvedValue(undefined);

    await sendSubscriptionRenewalReminders(NOW, sendReminder);

    expect(sendReminder).toHaveBeenCalledTimes(2);
    const calledIds = sendReminder.mock.calls.map(([s]) => s._id.toString());
    expect(calledIds.sort()).toEqual(
      [a._id.toString(), b._id.toString()].sort(),
    );
  });

  it("logs a failure and continues with the remaining subscriptions", async () => {
    await createSubscription();
    await createSubscription();
    await createSubscription();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const sendReminder = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);

    await expect(
      sendSubscriptionRenewalReminders(NOW, sendReminder),
    ).resolves.toBeUndefined();

    expect(sendReminder).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no subscription is due", async () => {
    const sendReminder = vi.fn();

    await sendSubscriptionRenewalReminders(NOW, sendReminder);

    expect(sendReminder).not.toHaveBeenCalled();
  });

  it("defaults to the no-op hand-off", async () => {
    const sub = await createSubscription();

    await expect(sendRenewalReminder(sub)).resolves.toBeUndefined();
    await expect(
      sendSubscriptionRenewalReminders(NOW),
    ).resolves.toBeUndefined();
  });
});

describe("renewal reminder job wiring", () => {
  it("defines the job single-attempt (no backoff)", () => {
    const define = vi.fn();

    registerAllJobs({ define } as never);

    const call = define.mock.calls.find(
      ([name]) => name === JOBS.SUBSCRIPTION.RENEWAL_REMINDERS,
    );
    expect(JOBS.SUBSCRIPTION.RENEWAL_REMINDERS).toBe(
      "subscription:renewal-reminders",
    );
    expect(call).toBeDefined();
    expect(call?.[2]).toBeUndefined();
  });

  it("schedules the job daily at 09:00", async () => {
    await syncRecurringJobs();

    expect(agendaEvery).toHaveBeenCalledWith(
      "0 9 * * *",
      JOBS.SUBSCRIPTION.RENEWAL_REMINDERS,
    );
  });
});
