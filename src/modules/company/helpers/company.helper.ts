import { PaginatedSearchQuery } from "@/types/query.types";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import { User } from "@/db/models/user";
import { Company, ICompany } from "@/db/models/company";
import { PAGINATION } from "@/constants/pagination";
import { extractLimitAndOffset } from "@/helpers/pagination";
import { STATUS } from "@/enums";
import { COMPANY_STATUS_TRANSITION } from "@/modules/company/utils/company.enum";

class CompanyHelper {
  /**
   * Get all companies with pagination and search
   */
  getCompanies = async (query: PaginatedSearchQuery) => {
    const searchValue = query.searchValue;

    const { page, pageSize, skips } = extractLimitAndOffset(
      query.page,
      query.pageSize,
    );

    const facetPipeline = createFacetPipeline(page, skips, pageSize);

    return Company.aggregate([
      {
        $match:
          searchValue && searchValue.length
            ? { name: { $regex: searchValue, $options: "i" } }
            : {},
      },
      { $sort: { createdAt: -1 } },
      ...facetPipeline,
    ]);
  };

  /**
   * Get users of a specific company
   */
  getCompanyUsers = async (companyRef: string, query: PaginatedSearchQuery) => {
    const limit = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
    const page = query.page || PAGINATION.DEFAULT_PAGE;
    const skips = (page - 1) * limit;
    const searchValue = query.searchValue;

    const facetPipeline = createFacetPipeline(page, skips, limit);

    return User.aggregate([
      {
        $match: {
          companyRef: ObjectId(companyRef),
          ...(searchValue && searchValue.length
            ? { $text: { $search: searchValue } }
            : {}),
        },
      },
      ...facetPipeline,
    ]);
  };

  /**
   * Update a company by ID
   */
  update = async (companyRef: string, updatedData: Partial<ICompany>) => {
    return Company.findByIdAndUpdate(companyRef, updatedData, {
      new: true,
    });
  };

  /**
   * Update a company and return both its pre-update and post-update state
   */
  updateWithPrevious = async (
    companyRef: string,
    updatedData: Partial<ICompany>,
  ) => {
    // The pre-image comes from the same atomic write, so when two requests
    // deactivate the company concurrently only one of them sees ACTIVE -> INACTIVE.
    const previous = await Company.findByIdAndUpdate(companyRef, updatedData, {
      new: false,
    });
    const updated = previous ? await Company.findById(companyRef) : null;
    return { previous, updated };
  };

  /**
   * Classify a companyStatus change; null when the status did not change
   */
  getStatusTransition = (
    previousStatus?: STATUS,
    nextStatus?: STATUS,
  ): COMPANY_STATUS_TRANSITION | null => {
    if (previousStatus === STATUS.ACTIVE && nextStatus === STATUS.INACTIVE) {
      return COMPANY_STATUS_TRANSITION.DEACTIVATED;
    }
    if (previousStatus === STATUS.INACTIVE && nextStatus === STATUS.ACTIVE) {
      return COMPANY_STATUS_TRANSITION.REACTIVATED;
    }
    return null;
  };

  /**
   * Get company details by ID
   */
  getCompanyDetails = async (id: string) => {
    return Company.findById(id).populate("userRef");
  };

  /**
   * Change user role within a company
   */
  changeUserRole = async (userId: string, companyRef: string, role: string) => {
    return User.updateOne({ _id: userId, companyRef }, { roles: role });
  };
}

export const companyHelper = new CompanyHelper();
