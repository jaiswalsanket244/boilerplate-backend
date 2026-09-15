import { User } from "@/db/models/user";
import { STATUS } from "@/enums";
import {
  USER_ANALYTICS_DURATION,
  USER_ANALYTICS_TYPE,
} from "@/modules/users/utils/users.enum";
import { evaluateUserAnalytics } from "@/modules/users/helpers/user-stats.helper";
import { faker } from "@faker-js/faker";
// No dayjs.extend(isoWeek) here on purpose: importing the helper above must be
// what makes isoWeek available on the shared dayjs instance.
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Frozen "now": the analytics helper builds the returned week/month list relative
// to the current date, so the results are only deterministic with time frozen.
const NOW = new Date("2026-09-15T12:00:00.000Z");

// Seed a user with an exact createdAt. Inserted raw (bypassing mongoose
// timestamps) so createdAt is exactly the requested date, not the frozen "now".
async function seedUserAt(createdAt: Date) {
  return User.collection.insertOne({
    email: faker.internet.email().toLowerCase(),
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    status: STATUS.ACTIVE,
    referralCode: faker.string.alphanumeric(12),
    createdAt,
    updatedAt: createdAt,
  });
}

const byKey = (rows: { key: string }[], key: string) =>
  rows.find((r) => r.key === key);

describe("evaluateUserAnalytics", () => {
  beforeEach(() => {
    // Only fake Date — faking setTimeout/setImmediate would stall the mongo driver.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("weekly", () => {
    it("counts users in the correct ISO week for single- and two-digit weeks", async () => {
      // 2026-02-03 is ISO week 6 (single digit); 2026-09-15 is the current ISO week.
      await seedUserAt(new Date("2026-02-03T10:00:00.000Z"));
      await seedUserAt(new Date("2026-09-15T10:00:00.000Z"));
      // Same ISO week 6, previous year, to exercise the lastYear column.
      await seedUserAt(new Date("2025-02-04T10:00:00.000Z"));

      const result = await evaluateUserAnalytics(
        USER_ANALYTICS_TYPE.TOTAL,
        USER_ANALYTICS_DURATION.WEEKLY,
        2026,
      );

      const currentWeek = dayjs(NOW).isoWeek();

      expect(byKey(result, "W6")).toEqual({
        key: "W6",
        thisYear: 1,
        lastYear: 1,
      });
      expect(byKey(result, `W${currentWeek}`)).toEqual({
        key: `W${currentWeek}`,
        thisYear: 1,
        lastYear: 0,
      });
    });

    it("returns 0 for weeks with no users", async () => {
      await seedUserAt(new Date("2026-02-03T10:00:00.000Z"));

      const result = await evaluateUserAnalytics(
        USER_ANALYTICS_TYPE.TOTAL,
        USER_ANALYTICS_DURATION.WEEKLY,
        2026,
      );

      expect(byKey(result, "W2")).toEqual({
        key: "W2",
        thisYear: 0,
        lastYear: 0,
      });
    });

    it("lists weeks from W1 to the current ISO week", async () => {
      const result = await evaluateUserAnalytics(
        USER_ANALYTICS_TYPE.TOTAL,
        USER_ANALYTICS_DURATION.WEEKLY,
        2026,
      );

      const currentWeek = dayjs(NOW).isoWeek();
      const keys = result.map((r) => r.key);

      expect(keys[0]).toBe("W1");
      expect(keys[keys.length - 1]).toBe(`W${currentWeek}`);
      expect(keys).toHaveLength(currentWeek);
    });
  });

  describe("monthly (unchanged)", () => {
    it("counts users in the correct month and lists Jan..current month", async () => {
      await seedUserAt(new Date("2026-02-15T10:00:00.000Z"));

      const result = await evaluateUserAnalytics(
        USER_ANALYTICS_TYPE.TOTAL,
        USER_ANALYTICS_DURATION.MONTHLY,
        2026,
      );

      const keys = result.map((r) => r.key);
      expect(keys[0]).toBe("Jan");
      expect(keys[keys.length - 1]).toBe("Sep");
      expect(byKey(result, "Feb")).toEqual({
        key: "Feb",
        thisYear: 1,
        lastYear: 0,
      });
      expect(byKey(result, "Jan")).toEqual({
        key: "Jan",
        thisYear: 0,
        lastYear: 0,
      });
    });
  });

  describe("daily (unchanged)", () => {
    it("counts users on the correct day", async () => {
      await seedUserAt(new Date("2026-09-10T10:00:00.000Z"));

      const result = await evaluateUserAnalytics(
        USER_ANALYTICS_TYPE.TOTAL,
        USER_ANALYTICS_DURATION.DAILY,
        2026,
      );

      expect(byKey(result, "10 Sep")).toEqual({
        key: "10 Sep",
        thisYear: 1,
        lastYear: 0,
      });
    });
  });

  it("extends dayjs with isoWeek itself (no other module did it here)", () => {
    // This file never calls dayjs.extend(isoWeek); the only import that could is
    // user-stats.helper. So isoWeek being callable proves the helper self-extends
    // and does not depend on users.helper being imported first.
    expect(typeof (dayjs() as unknown as { isoWeek?: unknown }).isoWeek).toBe(
      "function",
    );
  });
});
