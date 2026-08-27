import { z } from "zod";

import { PAGINATION } from "@/constants/pagination";

/*
 * Shared pagination validation building block. Modules spread
 * `paginationQueryShape` into their own query object schemas alongside their
 * filters so every endpoint coerces + bounds page/pageSize identically:
 * out-of-range, negative, and non-integer values are rejected with a 400,
 * while missing values are left undefined so downstream defaults apply.
 */
// Individual field schemas, exported so modules whose external param names
// diverge from page/pageSize (e.g. chat `limit`, user-query `size`) can reuse
// the EXACT same constraint under their own key instead of redeclaring it.
export const pageField = z.coerce
  .number()
  .int()
  .min(1)
  .max(PAGINATION.MAX_PAGE)
  .optional();

export const pageSizeField = z.coerce
  .number()
  .int()
  .min(1)
  .max(PAGINATION.MAX_PAGE_SIZE)
  .optional();

export const paginationQueryShape = {
  page: pageField,
  pageSize: pageSizeField,
};

export const pageQuerySchema = z.object(paginationQueryShape);

export type PaginationQuery = z.infer<typeof pageQuerySchema>;
