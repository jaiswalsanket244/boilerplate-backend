import { describe, expect, it } from "vitest";

import {
  buildNameSearchMatchStage,
  buildSearchFilter,
  getMongoFilter,
} from "@/helpers/query";
import { FilterValue } from "@/types/query.types";

describe("getMongoFilter search escaping", () => {
  it("builds a regex $or for plain text search", () => {
    const filter = getMongoFilter({
      searchValue: "john",
      searchColumns: ["name", "email"],
    });

    expect(filter.$or).toEqual([
      { name: { $regex: "john", $options: "i" } },
      { email: { $regex: "john", $options: "i" } },
    ]);
  });

  it("escapes regex metacharacters so they match literally", () => {
    const cases: Array<[string, string]> = [
      ["a(b", "a\\(b"],
      ["1.5", "1\\.5"],
      ["a+b", "a\\+b"],
      ["[x]", "\\[x\\]"],
      ["a\\b", "a\\\\b"],
    ];

    for (const [input, escaped] of cases) {
      const filter = getMongoFilter({
        searchValue: input,
        searchColumns: ["name"],
      });
      expect(filter.$or).toEqual([
        { name: { $regex: escaped, $options: "i" } },
      ]);
    }
  });

  it("produces no $or when searchValue is empty", () => {
    const filter = getMongoFilter({
      searchValue: "",
      searchColumns: ["name"],
    });
    expect(filter.$or).toBeUndefined();
  });

  it("produces no $or when searchValue is undefined", () => {
    const filter = getMongoFilter({ searchColumns: ["name"] });
    expect(filter.$or).toBeUndefined();
  });

  it("produces no $or when searchColumns is empty", () => {
    const filter = getMongoFilter({ searchValue: "john", searchColumns: [] });
    expect(filter.$or).toBeUndefined();
  });

  it("leaves multiselect, range, daterange and single-value filters unchanged", () => {
    const filters: FilterValue[] = [
      { id: "status", value: ["active", "pending"] },
      { id: "age", value: [18, 65] },
      { id: "createdAt", value: { from: "2020-01-01", to: "2020-12-31" } },
      { id: "role", value: "admin" },
    ];

    const filter = getMongoFilter({ filters });

    expect(filter.status).toEqual({ $in: ["active", "pending"] });
    expect(filter.age).toEqual({ $gte: 18, $lte: 65 });
    expect(filter.createdAt).toEqual({
      $gte: new Date("2020-01-01"),
      $lte: new Date("2020-12-31"),
    });
    expect(filter.role).toBe("admin");
    expect(filter.$or).toBeUndefined();
  });
});

describe("buildSearchFilter search escaping", () => {
  it("builds a regex $or for plain text search", () => {
    expect(buildSearchFilter("john", ["name", "email"])).toEqual({
      $or: [
        { name: { $regex: "john", $options: "i" } },
        { email: { $regex: "john", $options: "i" } },
      ],
    });
  });

  it("escapes regex metacharacters so they match literally", () => {
    expect(buildSearchFilter("a(b", ["name"])).toEqual({
      $or: [{ name: { $regex: "a\\(b", $options: "i" } }],
    });
    expect(buildSearchFilter("[x]", ["name"])).toEqual({
      $or: [{ name: { $regex: "\\[x\\]", $options: "i" } }],
    });
  });

  it("returns an empty object when searchValue is empty or undefined", () => {
    expect(buildSearchFilter("", ["name"])).toEqual({});
    expect(buildSearchFilter(undefined, ["name"])).toEqual({});
  });

  it("returns an empty object when there are no searchColumns", () => {
    expect(buildSearchFilter("john", [])).toEqual({});
  });
});

describe("buildNameSearchMatchStage escaping", () => {
  it("returns null for empty input", () => {
    expect(buildNameSearchMatchStage("")).toBeNull();
    expect(buildNameSearchMatchStage("   ")).toBeNull();
    expect(buildNameSearchMatchStage(undefined)).toBeNull();
  });

  it("escapes a single-term search value", () => {
    expect(buildNameSearchMatchStage("a(b")).toEqual({
      $match: {
        $or: [
          { "name.first": { $regex: "a\\(b", $options: "i" } },
          { "name.last": { $regex: "a\\(b", $options: "i" } },
        ],
      },
    });
  });

  it("escapes each term for a multi-term search value", () => {
    const stage = buildNameSearchMatchStage("a. b+");
    expect(stage).toEqual({
      $match: {
        $or: [
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ["$name.first", " ", "$name.last"] },
                regex: new RegExp("a\\. b\\+", "i"),
              },
            },
          },
          {
            $and: [
              {
                $or: [
                  { "name.first": { $regex: "a\\.", $options: "i" } },
                  { "name.last": { $regex: "a\\.", $options: "i" } },
                ],
              },
              {
                $or: [
                  { "name.first": { $regex: "b\\+", $options: "i" } },
                  { "name.last": { $regex: "b\\+", $options: "i" } },
                ],
              },
            ],
          },
        ],
      },
    });
  });
});
