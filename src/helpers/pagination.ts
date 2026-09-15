import { PaginatedResponse, PaginationOptions } from "@/types/pagination.types";
import { PAGINATION } from "../constants/pagination";

export function buildPaginatedResponse<T>(
  data: T[],
  { page, pageSize, totalCount }: PaginationOptions,
): PaginatedResponse<T> {
  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    data,
    pagination: {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      previousPage: page > 1 ? page - 1 : null,
    },
  };
}

export const extractLimitAndOffset = (
  page?: number | string,
  pageSize?: number | string,
) => {
  // Raw query values are untrusted: coerce, then reject anything that isn't a
  // finite positive integer so callers never receive zero, negative, fractional
  // or unbounded pagination. Fractional inputs fall back to the default rather
  // than being floored, keeping the "must be a valid whole page" contract simple.
  const parsedPage = Number(page);
  page =
    Number.isInteger(parsedPage) && parsedPage > 0
      ? parsedPage
      : PAGINATION.DEFAULT_PAGE;

  const parsedPageSize = Number(pageSize);
  pageSize =
    Number.isInteger(parsedPageSize) && parsedPageSize > 0
      ? Math.min(parsedPageSize, PAGINATION.MAX_PAGE_SIZE)
      : PAGINATION.DEFAULT_PAGE_SIZE;

  const skips = (page - 1) * pageSize;
  return { page, pageSize, skips };
};
