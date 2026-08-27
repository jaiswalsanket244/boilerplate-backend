import { describe, expect, it } from "vitest";

import { PAGINATION } from "@/constants/pagination";
import {
  pageField,
  pageSizeField,
  pageQuerySchema,
} from "@/validators/pagination.validation";

describe("pageQuerySchema", () => {
  describe("valid values", () => {
    it("accepts in-range numeric page/pageSize", () => {
      const parsed = pageQuerySchema.parse({ page: 2, pageSize: 25 });
      expect(parsed).toEqual({ page: 2, pageSize: 25 });
    });

    it("accepts the boundary maximums", () => {
      const parsed = pageQuerySchema.parse({
        page: PAGINATION.MAX_PAGE,
        pageSize: PAGINATION.MAX_PAGE_SIZE,
      });
      expect(parsed).toEqual({
        page: PAGINATION.MAX_PAGE,
        pageSize: PAGINATION.MAX_PAGE_SIZE,
      });
    });
  });

  describe("string-numeric coercion", () => {
    it("coerces numeric strings to integers", () => {
      const parsed = pageQuerySchema.parse({ page: "2", pageSize: "50" });
      expect(parsed).toEqual({ page: 2, pageSize: 50 });
    });
  });

  describe("missing/undefined", () => {
    it("allows an empty object (defaults applied downstream)", () => {
      expect(pageQuerySchema.parse({})).toEqual({});
    });

    it("allows explicit undefined", () => {
      expect(
        pageQuerySchema.parse({ page: undefined, pageSize: undefined }),
      ).toEqual({});
    });
  });

  describe("rejected values", () => {
    it("rejects a negative page", () => {
      expect(pageQuerySchema.safeParse({ page: -1 }).success).toBe(false);
    });

    it("rejects a negative pageSize", () => {
      expect(pageQuerySchema.safeParse({ pageSize: -1 }).success).toBe(false);
    });

    it("rejects page below 1 (zero)", () => {
      expect(pageQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    });

    it("rejects pageSize above MAX_PAGE_SIZE", () => {
      expect(
        pageQuerySchema.safeParse({ pageSize: PAGINATION.MAX_PAGE_SIZE + 1 })
          .success,
      ).toBe(false);
    });

    it("rejects page above MAX_PAGE", () => {
      expect(
        pageQuerySchema.safeParse({ page: PAGINATION.MAX_PAGE + 1 }).success,
      ).toBe(false);
    });

    it("rejects a non-integer page", () => {
      expect(pageQuerySchema.safeParse({ page: 1.5 }).success).toBe(false);
    });

    it("rejects a non-numeric string", () => {
      expect(pageQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
    });
  });
});

describe("pageField / pageSizeField", () => {
  it("coerce numeric strings to integers", () => {
    expect(pageField.parse("3")).toBe(3);
    expect(pageSizeField.parse("25")).toBe(25);
  });

  it("allow undefined so downstream defaults apply", () => {
    expect(pageField.parse(undefined)).toBeUndefined();
    expect(pageSizeField.parse(undefined)).toBeUndefined();
  });

  it("reject out-of-range and non-integer values", () => {
    expect(pageField.safeParse(0).success).toBe(false);
    expect(pageField.safeParse(-1).success).toBe(false);
    expect(pageField.safeParse(1.5).success).toBe(false);
    expect(pageField.safeParse(PAGINATION.MAX_PAGE + 1).success).toBe(false);
    expect(pageSizeField.safeParse(0).success).toBe(false);
    expect(pageSizeField.safeParse(PAGINATION.MAX_PAGE_SIZE + 1).success).toBe(
      false,
    );
  });

  it("accept the boundary maximums", () => {
    expect(pageField.parse(PAGINATION.MAX_PAGE)).toBe(PAGINATION.MAX_PAGE);
    expect(pageSizeField.parse(PAGINATION.MAX_PAGE_SIZE)).toBe(
      PAGINATION.MAX_PAGE_SIZE,
    );
  });
});
