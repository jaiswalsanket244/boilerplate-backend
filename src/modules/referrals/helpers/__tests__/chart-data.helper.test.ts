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

type ChartDatum = {
  _id: { year: number; month: number; week: number };
  value: number;
};

describe("chart-data.helper weekly buckets", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freeze = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs(iso).toDate());
  };

  it("returns exactly 12 weekly buckets ending at the current week", () => {
    freeze("2026-03-15T12:00:00Z");
    const { startDate } = getChartDateRange(DURATION.WEEKLY);
    const now = dayjs();
    const data: ChartDatum[] = [
      { _id: { year: now.isoWeekYear(), week: now.isoWeek(), month: 0 }, value: 5 },
    ];

    const result = fillTimeSeries(startDate, DURATION.WEEKLY, data)!;

    expect(result).toHaveLength(12);
    expect(result[0].label).toBe("Week 1");
    expect(result[11].label).toBe("Week 12");
    // Last bucket is the current ISO week and must carry its count.
    expect(result[11].value).toBe(5);
  });

  it("places an ISO week/year count in its matching bucket", () => {
    freeze("2026-03-15T12:00:00Z");
    const { startDate } = getChartDateRange(DURATION.WEEKLY);
    const target = startDate.add(4, "week");
    const data: ChartDatum[] = [
      {
        _id: { year: target.isoWeekYear(), week: target.isoWeek(), month: 0 },
        value: 9,
      },
    ];

    const result = fillTimeSeries(startDate, DURATION.WEEKLY, data)!;

    expect(result[4].value).toBe(9);
    expect(result.reduce((sum, b) => sum + b.value, 0)).toBe(9);
  });

  it("places a week spanning the new year in the correct bucket", () => {
    // Dec 31 2025 belongs to ISO week 1 of ISO week-year 2026, so this bucket's
    // calendar year (2025) differs from its ISO week-year (2026) — the case the
    // old calendar-year lookup key got wrong.
    freeze("2025-12-31T12:00:00Z");
    const { startDate } = getChartDateRange(DURATION.WEEKLY);
    const buckets = Array.from({ length: 12 }, (_, i) => startDate.add(i, "week"));
    const boundaryIdx = buckets.findIndex((d) => d.year() !== d.isoWeekYear());
    expect(boundaryIdx).toBeGreaterThanOrEqual(0);

    const boundary = buckets[boundaryIdx];
    const data: ChartDatum[] = [
      {
        _id: {
          year: boundary.isoWeekYear(),
          week: boundary.isoWeek(),
          month: 0,
        },
        value: 7,
      },
    ];

    const result = fillTimeSeries(startDate, DURATION.WEEKLY, data)!;

    expect(result[boundaryIdx].value).toBe(7);
    expect(result.reduce((sum, b) => sum + b.value, 0)).toBe(7);
  });

  it("groups weekly by ISO week and ISO week-year", () => {
    expect(getTimeGrouping(DURATION.WEEKLY)).toEqual({
      week: { $isoWeek: "$createdAt" },
      year: { $isoWeekYear: "$createdAt" },
    });
  });
});

describe("chart-data.helper monthly and yearly buckets unchanged", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs("2026-03-15T12:00:00Z").toDate());
  });

  it("returns 12 monthly buckets", () => {
    const { startDate } = getChartDateRange(DURATION.MONTHLY);
    const result = fillTimeSeries(startDate, DURATION.MONTHLY, [])!;
    expect(result).toHaveLength(12);
  });

  it("returns 5 yearly buckets", () => {
    const { startDate } = getChartDateRange(DURATION.YEARLY);
    const result = fillTimeSeries(startDate, DURATION.YEARLY, [])!;
    expect(result).toHaveLength(5);
  });
});
