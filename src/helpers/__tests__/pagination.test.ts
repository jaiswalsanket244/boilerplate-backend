import { describe, expect, it } from "vitest";

import { PAGINATION } from "@/constants/pagination";
import { extractLimitAndOffset } from "@/helpers/pagination";

describe("extractLimitAndOffset", () => {
  it("falls back to defaults when both args are undefined", () => {
    expect(extractLimitAndOffset()).toEqual({
      page: PAGINATION.DEFAULT_PAGE,
      pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
      skips: 0,
    });
  });

  it("parses numeric strings and computes skips", () => {
    expect(extractLimitAndOffset("3", "20")).toEqual({
      page: 3,
      pageSize: 20,
      skips: 40,
    });
  });

  it("clamps pageSize above the max to MAX_PAGE_SIZE", () => {
    const { pageSize, skips } = extractLimitAndOffset(2, 100000);
    expect(pageSize).toBe(PAGINATION.MAX_PAGE_SIZE);
    expect(skips).toBe((2 - 1) * PAGINATION.MAX_PAGE_SIZE);
  });

  it("falls back to defaults for negative page and pageSize", () => {
    expect(extractLimitAndOffset(-2, -5)).toEqual({
      page: PAGINATION.DEFAULT_PAGE,
      pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
      skips: 0,
    });
  });

  it("falls back to defaults for zero page and zero pageSize", () => {
    expect(extractLimitAndOffset(0, 0)).toEqual({
      page: PAGINATION.DEFAULT_PAGE,
      pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
      skips: 0,
    });
  });

  it("falls back to defaults for a non-numeric string", () => {
    expect(extractLimitAndOffset("abc", "xyz")).toEqual({
      page: PAGINATION.DEFAULT_PAGE,
      pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
      skips: 0,
    });
  });

  it("falls back to the default page for a fractional page", () => {
    const { page } = extractLimitAndOffset(2.5, 10);
    expect(page).toBe(PAGINATION.DEFAULT_PAGE);
  });

  it("falls back to the default pageSize for a fractional pageSize", () => {
    const { pageSize } = extractLimitAndOffset(2, 10.5);
    expect(pageSize).toBe(PAGINATION.DEFAULT_PAGE_SIZE);
  });

  it("never produces a negative skips value", () => {
    const { skips } = extractLimitAndOffset(-100, -100);
    expect(skips).toBeGreaterThanOrEqual(0);
  });
});
