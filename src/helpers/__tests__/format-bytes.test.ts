import { describe, expect, it } from "vitest";

import { formatBytes } from "@/helpers/format-bytes";

describe("formatBytes", () => {
  it("formats values below 1 KB as bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats fractional kilobytes with one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("drops a trailing .0 on whole values", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 ** 2)).toBe("1 MB");
  });

  it("scales through larger units", () => {
    expect(formatBytes(1.25 * 1024 ** 2)).toBe("1.3 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
    expect(formatBytes(2.5 * 1024 ** 4)).toBe("2.5 TB");
    expect(formatBytes(1024 ** 5)).toBe("1 PB");
  });

  it("promotes to the next unit when rounding reaches 1024", () => {
    expect(formatBytes(1024 ** 2 - 1)).toBe("1 MB");
  });

  it("stays in PB for values beyond the largest unit", () => {
    expect(formatBytes(2048 * 1024 ** 5)).toBe("2048 PB");
  });

  it("rounds fractional byte counts", () => {
    expect(formatBytes(10.4)).toBe("10 B");
  });

  it("throws on negative or non-finite input", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
    expect(() => formatBytes(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
