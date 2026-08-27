import { describe, expect, it } from "vitest";

import { PAGINATION } from "@/constants/pagination";
import { extractLimitAndOffset } from "@/helpers/pagination";

describe("extractLimitAndOffset", () => {
  it("applies defaults when page/pageSize are missing", () => {
    expect(extractLimitAndOffset()).toEqual({
      page: PAGINATION.DEFAULT_PAGE,
      pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
      skips: 0,
    });
  });

  it("computes skips from valid values", () => {
    expect(extractLimitAndOffset(3, 20)).toEqual({
      page: 3,
      pageSize: 20,
      skips: 40,
    });
  });

  it("coerces numeric strings", () => {
    expect(extractLimitAndOffset("2", "15")).toEqual({
      page: 2,
      pageSize: 15,
      skips: 15,
    });
  });

  it("clamps a negative page to 1 so skips never go negative", () => {
    expect(extractLimitAndOffset(-5, 10)).toEqual({
      page: 1,
      pageSize: 10,
      skips: 0,
    });
  });

  it("clamps a negative pageSize to 1", () => {
    const { pageSize } = extractLimitAndOffset(1, -10);
    expect(pageSize).toBe(1);
  });
});
