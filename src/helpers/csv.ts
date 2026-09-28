/*
 * Mongoose `.lean()` leaves ObjectId instances on the row; render them as bare
 * hex, not the opaque object JSON.stringify would emit.
 */
function isObjectIdLike(value: object): boolean {
  return typeof (value as { toHexString?: unknown }).toHexString === "function";
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let raw: string;
  if (value instanceof Date) {
    raw = value.toISOString();
  } else if (typeof value === "object") {
    raw = isObjectIdLike(value) ? String(value) : JSON.stringify(value);
  } else {
    raw = String(value);
  }

  /*
   * Neutralize spreadsheet formula injection: Excel/Sheets execute a cell that
   * begins with one of these. Exported fields are often user-influenced
   * (names, emails, metadata), so prefix a literal quote to defuse it.
   */
  if (/^[=+\-@\t\r]/.test(raw)) {
    raw = `'${raw}`;
  }

  /*
   * RFC-4180: quote when the cell contains a comma, quote, CR or LF; double
   * any embedded quote.
   */
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv(
  columns: readonly string[],
  rows: Iterable<unknown[]>,
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}
