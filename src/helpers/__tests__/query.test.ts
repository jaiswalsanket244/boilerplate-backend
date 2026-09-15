import { describe, expect, it } from "vitest";

import { parseQueryString } from "@/helpers/query";

describe("parseQueryString sorting", () => {
  it("parses lower-case asc and desc", () => {
    expect(parseQueryString({ sort: "createdAt#asc" }).sorting).toEqual([
      { id: "createdAt", desc: false },
    ]);
    expect(parseQueryString({ sort: "createdAt#desc" }).sorting).toEqual([
      { id: "createdAt", desc: true },
    ]);
  });

  it("matches direction case-insensitively", () => {
    expect(parseQueryString({ sort: "name#ASC" }).sorting).toEqual([
      { id: "name", desc: false },
    ]);
    expect(parseQueryString({ sort: "name#Asc" }).sorting).toEqual([
      { id: "name", desc: false },
    ]);
    expect(parseQueryString({ sort: "createdAt#DESC" }).sorting).toEqual([
      { id: "createdAt", desc: true },
    ]);
    expect(parseQueryString({ sort: "createdAt#Desc" }).sorting).toEqual([
      { id: "createdAt", desc: true },
    ]);
  });

  it("trims surrounding whitespace around the direction", () => {
    expect(parseQueryString({ sort: "name# DESC " }).sorting).toEqual([
      { id: "name", desc: true },
    ]);
  });

  it("parses multiple comma-separated sorts", () => {
    expect(
      parseQueryString({ sort: "name#Asc,createdAt#DESC" }).sorting,
    ).toEqual([
      { id: "name", desc: false },
      { id: "createdAt", desc: true },
    ]);
  });

  it("ignores unknown directions", () => {
    expect(parseQueryString({ sort: "name#up" }).sorting).toEqual([]);
  });

  it("keeps valid sorts while dropping an unknown direction", () => {
    expect(
      parseQueryString({ sort: "name#up,createdAt#desc" }).sorting,
    ).toEqual([{ id: "createdAt", desc: true }]);
  });
});

describe("parseQueryString filters", () => {
  it("excludes page, pageSize, search and sort from filters", () => {
    const { filters } = parseQueryString({
      page: "1",
      pageSize: "10",
      search: "john",
      sort: "createdAt#desc",
    });
    expect(filters).toEqual([]);
  });

  it("still parses real filters alongside excluded keys", () => {
    const { filters } = parseQueryString({
      page: "1",
      status: "select#active",
      sort: "createdAt#desc",
    });
    expect(filters).toEqual([{ id: "status", value: "active" }]);
  });
});
