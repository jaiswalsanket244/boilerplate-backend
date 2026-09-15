// Regression tests for CYR-99: user search text must be matched as a literal
// string, never interpreted as a regex, in getMongoFilter/buildSearchFilter.
import { describe, expect, it } from "vitest";

import {
  buildSearchFilter,
  escapeRegex,
  getMongoFilter,
} from "@/helpers/query";
import { FilterValue } from "@/types/query.types";

const SPECIAL_INPUTS = ["a(b", "1.5", "a+b", "[x]", "\\", "a|b", "^x$", "a?b*"];

describe("escapeRegex", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeRegex("john")).toBe("john");
  });

  it("escapes regex metacharacters into literals that compile and match only themselves", () => {
    for (const input of SPECIAL_INPUTS) {
      const escaped = escapeRegex(input);
      expect(() => new RegExp(escaped)).not.toThrow();
      // The escaped pattern must match the literal input and nothing else.
      expect(new RegExp(`^${escaped}$`).test(input)).toBe(true);
    }
  });
});

describe("getMongoFilter search", () => {
  const searchColumns = ["name", "email"];

  it("produces the same $or filter as raw text for non-special input", () => {
    expect(getMongoFilter({ searchValue: "john", searchColumns })).toEqual({
      $or: [
        { name: { $regex: "john", $options: "i" } },
        { email: { $regex: "john", $options: "i" } },
      ],
    });
  });

  it("escapes special characters so the $regex compiles and matches literally", () => {
    for (const input of SPECIAL_INPUTS) {
      const filter = getMongoFilter({ searchValue: input, searchColumns });
      const or = filter.$or as { [k: string]: { $regex: string } }[];
      for (const clause of or) {
        const [{ $regex: pattern }] = Object.values(clause);
        expect(() => new RegExp(pattern)).not.toThrow();
        expect(new RegExp(`^${pattern}$`).test(input)).toBe(true);
      }
    }
  });

  it("returns no search condition for empty string", () => {
    expect(getMongoFilter({ searchValue: "", searchColumns })).toEqual({});
  });

  it("returns no search condition for undefined search", () => {
    expect(getMongoFilter({ searchColumns })).toEqual({});
  });

  it("returns no search condition when searchColumns is empty", () => {
    expect(getMongoFilter({ searchValue: "john", searchColumns: [] })).toEqual(
      {},
    );
  });

  it("leaves multiselect/range/date filter handling unchanged", () => {
    const filters: FilterValue[] = [
      { id: "role", value: ["admin", "user"] },
      { id: "age", value: [18, 65] },
      { id: "createdAt", value: { from: "2024-01-01", to: "2024-12-31" } },
      { id: "status", value: "active" },
    ];

    expect(getMongoFilter({ filters })).toEqual({
      role: { $in: ["admin", "user"] },
      age: { $gte: 18, $lte: 65 },
      createdAt: {
        $gte: new Date("2024-01-01"),
        $lte: new Date("2024-12-31"),
      },
      status: "active",
    });
  });

  it("combines escaped search with filters", () => {
    const filters: FilterValue[] = [{ id: "role", value: ["admin"] }];
    const filter = getMongoFilter({
      searchValue: "a+b",
      searchColumns: ["name"],
      filters,
    });

    expect(filter).toEqual({
      $or: [{ name: { $regex: "a\\+b", $options: "i" } }],
      role: { $in: ["admin"] },
    });
  });
});

describe("buildSearchFilter", () => {
  const searchColumns = ["name", "email"];

  it("produces the same $or filter as raw text for non-special input", () => {
    expect(buildSearchFilter("john", searchColumns)).toEqual({
      $or: [
        { name: { $regex: "john", $options: "i" } },
        { email: { $regex: "john", $options: "i" } },
      ],
    });
  });

  it("escapes special characters so the $regex compiles and matches literally", () => {
    for (const input of SPECIAL_INPUTS) {
      const filter = buildSearchFilter(input, searchColumns);
      const or = filter.$or as { [k: string]: { $regex: string } }[];
      for (const clause of or) {
        const [{ $regex: pattern }] = Object.values(clause);
        expect(() => new RegExp(pattern)).not.toThrow();
        expect(new RegExp(`^${pattern}$`).test(input)).toBe(true);
      }
    }
  });

  it("returns {} for empty string", () => {
    expect(buildSearchFilter("", searchColumns)).toEqual({});
  });

  it("returns {} for undefined search", () => {
    expect(buildSearchFilter(undefined, searchColumns)).toEqual({});
  });
});
