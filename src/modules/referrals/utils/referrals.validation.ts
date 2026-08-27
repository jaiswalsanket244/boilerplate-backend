import { PAGINATION } from "@/constants/pagination";
import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";
import { DURATION } from "./referrals.enum";

// ==================== Schemas ====================

// Shared page/pageSize bounds so out-of-range values (page=-5,
// pageSize=100000) are rejected up front instead of reaching the DB query.
const pageSchema = z.coerce.number().int().min(1).optional();
const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PAGINATION.MAX_PAGE_SIZE)
  .optional();

export const GetAllReferralsQuerySchema = z.object({
  search: z.string().optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
  rewardStatus: z.string().optional(),
  status: z.string().optional(),
});

// ==================== Validation Schemas ====================

export const GetAllReferralsValidationSchema = {
  query: GetAllReferralsQuerySchema,
} as const;

// ==================== Validators ====================

const getAllReferralsValidator = validate(
  GetAllReferralsValidationSchema,
  validationErrorHandler,
);

const applyReferralValidator = validate(
  {
    body: z.object({
      referralCode: z.string().min(1, "Referral code is required"),
    }),
  },
  validationErrorHandler,
);

const getReferralMetricsValidator = validate(
  {
    query: z.object({
      startDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid start date",
      }),
      endDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid end date",
      }),
    }),
  },
  validationErrorHandler,
);

const getActivityChartValidator = validate(
  {
    query: z.object({
      timeframe: z.enum(DURATION),
    }),
  },
  validationErrorHandler,
);
const getRewardsIssuedChartValidator = validate(
  {
    query: z.object({
      timeframe: z.enum(DURATION),
    }),
  },
  validationErrorHandler,
);

const redeemReferralValidator = validate(
  {
    params: z.object({
      id: z.string().min(1, "Referral ID is required"),
    }),
  },
  validationErrorHandler,
);

const sendReferralInviteValidator = validate(
  {
    body: z.object({
      email: z.email("Invalid email address"),
    }),
  },
  validationErrorHandler,
);

// ==================== Super Admin Schemas ====================

const GetAllReferralsSuperAdminQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  searchValue: z.string().optional(),
});

// ==================== Super Admin Validation Schemas ====================

const GetAllReferralsSuperAdminValidationSchema = {
  query: GetAllReferralsSuperAdminQuerySchema,
} as const;

// ==================== Super Admin Validators ====================

const getAllReferralsSuperAdminValidator = validate(
  GetAllReferralsSuperAdminValidationSchema,
  validationErrorHandler,
);

export const referralValidators = {
  getAllReferrals: getAllReferralsValidator,
  applyReferral: applyReferralValidator,
  getReferralMetrics: getReferralMetricsValidator,
  getActivityChart: getActivityChartValidator,
  getRewardsIssuedChart: getRewardsIssuedChartValidator,
  redeemReferral: redeemReferralValidator,
  sendReferralInvite: sendReferralInviteValidator,
  getAllReferralsSuperAdmin: getAllReferralsSuperAdminValidator,
};
