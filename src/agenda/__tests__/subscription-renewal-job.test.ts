import mongoose from "mongoose";
import type { Agenda } from "agenda";
import { describe, expect, it, vi } from "vitest";

import "@/tests/mocks/database.mock";

import { agendaService } from "@/agenda/agenda.service";
import * as reminderHook from "@/agenda/helpers/subscription-renewal-reminder.helper";
import {
  findSubscriptionsDueForRenewal,
  RENEWAL_REMINDER_LEAD_DAYS,
  sendSubscriptionRenewalReminders,
} from "@/agenda/helpers/subscription-renewal.helper";
import { registerAllJobs } from "@/agenda/register";
import { syncRecurringJobs } from "@/agenda/schedule";
import { JOBS } from "@/agenda/utils/job-names.constant";
import { type ISubscription, Subscription } from "@/db/models/subscription";
import { STATUS } from "@/enums";

// Afternoon on purpose: the match must be on the UTC day, not 7 x 24h from this instant.
const NOW = new Date("2026-09-30T15:00:00Z");
const toSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function createSubscription(
  overrides: Partial<ISubscription> & { currentPeriodEnds: number },
) {
  return Subscription.create({
    userRef: new mongoose.Types.ObjectId(),
    companyRef: new mongoose.Types.ObjectId(),
    price: 1000,
    currentPeriodStarts: toSeconds("2026-09-07T00:00:00Z"),
    status: STATUS.ACTIVE,
    stripeSubscriptionId: `sub_${new mongoose.Types.ObjectId().toString()}`,
    planName: "Pro",
    ...overrides,
  });
}

async function dueIds(now: Date = NOW) {
  const found = await findSubscriptionsDueForRenewal(now);
  return found.map((s) => String(s._id)).sort();
}

describe("findSubscriptionsDueForRenewal", () => {
  it("defaults the lead time to 7 days", () => {
    expect(RENEWAL_REMINDER_LEAD_DAYS).toBe(7);
  });

  it("matches only the UTC day 7 days out, not 6 or 8", async () => {
    const sixDays = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-06T23:59:59Z"),
    });
    const sevenStart = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T00:00:00Z"),
    });
    const sevenEnd = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T23:59:59Z"),
    });
    const eightDays = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-08T00:00:00Z"),
    });

    const ids = await dueIds();

    expect(ids).toEqual([String(sevenStart._id), String(sevenEnd._id)].sort());
    expect(ids).not.toContain(String(sixDays._id));
    expect(ids).not.toContain(String(eightDays._id));
  });

  it("excludes subscriptions cancelled at period end", async () => {
    await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T12:00:00Z"),
      subscriptionCancellationRequested: true,
    });

    expect(await dueIds()).toEqual([]);
  });

  it("excludes non-ACTIVE subscriptions", async () => {
    for (const status of [STATUS.INACTIVE, STATUS.PAST_DUE, STATUS.DELETED]) {
      await createSubscription({
        currentPeriodEnds: toSeconds("2026-10-07T12:00:00Z"),
        status,
      });
    }

    expect(await dueIds()).toEqual([]);
  });

  it("excludes subscriptions without a stripeSubscriptionId", async () => {
    await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T12:00:00Z"),
      stripeSubscriptionId: undefined,
    });
    await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T12:00:00Z"),
      stripeSubscriptionId: "",
    });

    expect(await dueIds()).toEqual([]);
  });

  it("reads currentPeriodEnds as unix seconds, not milliseconds", async () => {
    const seconds = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T12:00:00Z"),
    });
    // Same instant stored in ms must not be treated as a match.
    await createSubscription({
      currentPeriodEnds: new Date("2026-10-07T12:00:00Z").getTime(),
    });

    expect(await dueIds()).toEqual([String(seconds._id)]);
  });

  it("defaults `now` to the current time", async () => {
    const due = await createSubscription({
      currentPeriodEnds: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });

    expect(await dueIds(new Date())).toEqual([String(due._id)]);
    const found = await findSubscriptionsDueForRenewal();
    expect(found.map((s) => String(s._id))).toEqual([String(due._id)]);
  });
});

describe("sendSubscriptionRenewalReminders", () => {
  it("calls the reminder hook once per due subscription only", async () => {
    const a = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T08:00:00Z"),
    });
    const b = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T20:00:00Z"),
    });
    await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-08T08:00:00Z"),
    });
    const hook = vi
      .spyOn(reminderHook, "sendSubscriptionRenewalReminder")
      .mockResolvedValue();

    await sendSubscriptionRenewalReminders(NOW);

    expect(hook).toHaveBeenCalledTimes(2);
    const called = hook.mock.calls.map(([s]) => String(s._id)).sort();
    expect(called).toEqual([String(a._id), String(b._id)].sort());
  });

  it("logs a failing subscription and keeps going with the rest", async () => {
    const failing = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T08:00:00Z"),
    });
    const ok = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T09:00:00Z"),
    });
    const hook = vi
      .spyOn(reminderHook, "sendSubscriptionRenewalReminder")
      .mockImplementation(async (s) => {
        if (String(s._id) === String(failing._id)) throw new Error("boom");
      });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendSubscriptionRenewalReminders(NOW)).resolves.toBeUndefined();

    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls.map(([s]) => String(s._id))).toContain(
      String(ok._id),
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(String(failing._id)),
      expect.any(Error),
    );
  });

  it("does not call the hook when nothing is due", async () => {
    const hook = vi.spyOn(reminderHook, "sendSubscriptionRenewalReminder");

    await sendSubscriptionRenewalReminders(NOW);

    expect(hook).not.toHaveBeenCalled();
  });
});

describe("sendSubscriptionRenewalReminder (placeholder hook)", () => {
  it("logs the subscription it was given", async () => {
    const sub = await createSubscription({
      currentPeriodEnds: toSeconds("2026-10-07T12:00:00Z"),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await reminderHook.sendSubscriptionRenewalReminder(sub.toObject());

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("2026-10-07T12:00:00.000Z"),
    );
  });
});

describe("renewal-reminder job wiring", () => {
  it("names the job subscription:renewal-reminders", () => {
    expect(JOBS.SUBSCRIPTION.RENEWAL_REMINDERS).toBe(
      "subscription:renewal-reminders",
    );
  });

  it("defines the job single-attempt and runs the reminders", async () => {
    const define = vi.fn();
    registerAllJobs({ define } as unknown as Agenda);

    const call = define.mock.calls.find(
      ([name]) => name === JOBS.SUBSCRIPTION.RENEWAL_REMINDERS,
    );
    expect(call).toBeDefined();
    // No options object means no backoff, so Agenda never retries it.
    expect(call?.[2]).toBeUndefined();

    await createSubscription({
      currentPeriodEnds: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });
    const hook = vi
      .spyOn(reminderHook, "sendSubscriptionRenewalReminder")
      .mockResolvedValue();
    await call?.[1]();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("schedules the job daily at 09:00", async () => {
    const every = vi
      .spyOn(agendaService, "every")
      .mockResolvedValue(undefined as never);

    await syncRecurringJobs();

    expect(every).toHaveBeenCalledWith(
      "0 9 * * *",
      JOBS.SUBSCRIPTION.RENEWAL_REMINDERS,
    );
  });
});
