import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fillTimeSeries,
  getChartDateRange,
  getTimeGrouping,
} from "@/modules/referrals/helpers/chart-data.helper";
import { DURATION } from "@/modules/referrals/utils/referrals.enum";

dayjs.extend(isoWeek);

describe("chart-data.helper weekly buckets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 12 buckets, oldest first, last bucket is the current week", () => {
    const { startDate } = getChartDateRange(DURATION.WEEKLY);
    const result = fillTimeSeries(startDate, DURATION.WEEKLY, [])!;

    expect(result).toHaveLength(12);
    expect(result.map((b) => b.label)).toEqual(
      Array.from({ length: 12 }, (_, i) => `Week ${i + 1}`),
    );

    const now = dayjs();
    const lastBucketWeek = startDate.add(11, "week");
    expect(lastBucketWeek.isoWeek()).toBe(now.isoWeek());
    expect(lastBucketWeek.isoWeekYear()).toBe(now.isoWeekYear());
  });

  it("places a count grouped under an ISO week/year in the matching bucket", () => {
    const now = dayjs();
    const data = [
      {
        _id: { year: now.isoWeekYear(), week: now.isoWeek(), month: 0 },
        value: 5,
      },
    ];

    const result = fillTimeSeries(
      startFor(DURATION.WEEKLY),
      DURATION.WEEKLY,
      data,
    )!;

    expect(result[result.length - 1].value).toBe(5);
    expect(result.slice(0, -1).every((b) => b.value === 0)).toBe(true);
  });

  it("places a week spanning the new year (ISO week 1 with a December Monday) correctly", () => {
    // 2024-12-30 is a Monday: ISO week 1 of isoWeekYear 2025 while the calendar
    // year is still 2024, so the fix must key on isoWeekYear(), not year().
    const start = dayjs("2024-12-30");
    const data = [{ _id: { year: 2025, week: 1, month: 0 }, value: 7 }];

    const result = fillTimeSeries(start, DURATION.WEEKLY, data)!;

    expect(result[0].value).toBe(7);
  });
});

describe("chart-data.helper grouping", () => {
  it("weekly grouping uses $isoWeek/$isoWeekYear with week/year keys", () => {
    expect(getTimeGrouping(DURATION.WEEKLY)).toEqual({
      week: { $isoWeek: "$createdAt" },
      year: { $isoWeekYear: "$createdAt" },
    });
  });
});

describe("chart-data.helper monthly and yearly are unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("monthly returns 12 buckets", () => {
    const { startDate } = getChartDateRange(DURATION.MONTHLY);
    expect(fillTimeSeries(startDate, DURATION.MONTHLY, [])!).toHaveLength(12);
  });

  it("yearly returns 5 buckets", () => {
    const { startDate } = getChartDateRange(DURATION.YEARLY);
    expect(fillTimeSeries(startDate, DURATION.YEARLY, [])!).toHaveLength(5);
  });
});

function startFor(timeframe: DURATION) {
  return getChartDateRange(timeframe).startDate;
}
