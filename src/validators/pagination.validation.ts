import { z } from "zod";

import { PAGINATION } from "@/constants/pagination";

/*
 * Shared pagination validation building block. Modules spread
 * `paginationQueryShape` into their own query object schemas alongside their
 * filters so every endpoint coerces + bounds page/pageSize identically:
 * out-of-range, negative, and non-integer values are rejected with a 400,
 * while missing values are left undefined so downstream defaults apply.
 */
export const paginationQueryShape = {
  page: z.coerce.number().int().min(1).max(PAGINATION.MAX_PAGE).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .optional(),
};

export const pageQuerySchema = z.object(paginationQueryShape);

export type PaginationQuery = z.infer<typeof pageQuerySchema>;
