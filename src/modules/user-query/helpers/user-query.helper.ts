import {
  IUserQuery,
  IUserQueryDocument,
  UserQuery,
} from "@/db/models/userQuery";
import { ObjectId } from "@/helpers/common";
import { extractLimitAndOffset } from "@/helpers/pagination";
import { PAGINATION } from "@/constants/pagination";
import { createFacetPipeline } from "@/helpers/query";
import {
  IUserQueryFilter,
  TGetAllUserQueriesQuery,
} from "@/modules/user-query/utils/user-query.types";
import {
  USER_QUERY_STATUS,
  USER_QUERY_SUBJECT,
} from "@/modules/user-query/utils/user-query.enum";
import { FilterQuery } from "mongoose";
import { Company } from "@/db/models/company";

class UserQueryHelper {
  findOne = async (
    condition: FilterQuery<IUserQueryDocument>,
  ): Promise<IUserQueryDocument | null> => {
    return UserQuery.findOne(condition);
  };

  getAllUserQueries = async (filter: IUserQueryFilter) => {
    const {
      page = PAGINATION.DEFAULT_PAGE,
      pageSize = PAGINATION.DEFAULT_PAGE_SIZE,
      search,
      subjects,
      status,
      dateFrom,
      dateTo,
      sortBy = "createdAt",
      sortOrder = "desc",
      userId,
      companyRef,
    } = filter;

    const limit = pageSize;
    const skips = (page - 1) * limit;

    const facetPipeline = createFacetPipeline(page, skips, limit);

    const matchFilter: Record<string, any> = {};

    // User and company filters
    if (userId) {
      matchFilter.userRef = ObjectId(userId);
    }
    if (companyRef) {
      matchFilter.companyRef = ObjectId(companyRef);
    }

    if (subjects?.length) {
      matchFilter.subject = { $in: subjects };
    }

    if (status?.length) {
      matchFilter.status = { $in: status };
    }

    if (dateFrom || dateTo) {
      matchFilter.createdAt = {};
      if (dateFrom) {
        matchFilter.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Set to end of day
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        matchFilter.createdAt.$lte = endOfDay;
      }
    }

    if (search?.length) {
      const searchRegex = new RegExp(search, "i");
      matchFilter.$or = [
        { "name.first": { $regex: searchRegex } },
        { "name.last": { $regex: searchRegex } },
        { email: { $regex: searchRegex } },
      ];
    }

    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    return UserQuery.aggregate([
      { $match: matchFilter },
      { $sort: sortOptions },
      ...facetPipeline,
    ]);
  };

  parseQueryParams = (query: TGetAllUserQueriesQuery): IUserQueryFilter => {
    const {
      page,
      size,
      search,
      subjects,
      status,
      dateFrom,
      dateTo,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query;

    // Normalize the aliased `size` param to the standard page/pageSize
    // defaults (page 1, size 10) shared across the API.
    const { page: normalizedPage, pageSize } = extractLimitAndOffset(
      page,
      size,
    );

    const filter: IUserQueryFilter = {
      page: normalizedPage,
      pageSize,
      sortBy: String(sortBy),
      sortOrder: (sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
    };

    if (search) {
      filter.search = String(search);
    }

    if (subjects) {
      filter.subjects = subjects.split(",") as USER_QUERY_SUBJECT[];
    }

    if (status) {
      filter.status = status.split(",") as USER_QUERY_STATUS[];
    }

    if (dateFrom) {
      filter.dateFrom = String(dateFrom);
    }

    if (dateTo) {
      filter.dateTo = String(dateTo);
    }

    return filter;
  };

  create = async (
    document: Partial<IUserQuery>,
  ): Promise<IUserQueryDocument> => {
    return UserQuery.create(document);
  };

  public findAndUpdate = async ({
    id,
    update,
  }: {
    id: string;
    update: Partial<IUserQuery>;
  }): Promise<IUserQueryDocument | null> => {
    return UserQuery.findByIdAndUpdate(id, update, { new: true });
  };

  public delete = async (id: string): Promise<IUserQueryDocument | null> => {
    return UserQuery.findByIdAndDelete(id);
  };

  public getCompany = async (id: string) => {
    return Company.findOne({ _id: id });
  };
}

export const userQueryHelper = new UserQueryHelper();
