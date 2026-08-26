import apiConfig from "@/config/api";
import envConfig from "@/config/env";
import { ERROR_CODES } from "@/constants/error-codes";
import { SERVER_ENV } from "@/enums";
import {
  AUTH_RESPONSE_MESSAGES,
  LOGIN_RATE_LIMIT,
} from "@/modules/auth/utils/auth.constant";
import { rateLimit } from "express-rate-limit";

const rateLimiter = rateLimit({
  windowMs: apiConfig.RATE_LIMIT_WINDOW_MS,
  limit: apiConfig.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: apiConfig.RATE_LIMIT_DEFAULT_MESSAGE,
  // Exempt the admin job dashboard: it polls too frequently for this limit.
  skip: (req) => req.path.startsWith("/admin/agendash"),
});

/**
 * Stricter per-IP limiter mounted only on the login route, to slow
 * credential-stuffing that spreads guesses across many accounts (which the
 * per-account lockout alone can't see).
 */
export const loginRateLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT.WINDOW_MS,
  limit: LOGIN_RATE_LIMIT.MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: AUTH_RESPONSE_MESSAGES.LOGIN_RATE_LIMITED,
    messageCode: ERROR_CODES.RATE_LIMIT_EXCEEDED,
  },
  // The lockout integration tests drive 15+ attempts from a single IP; a strict
  // per-IP cap would 429 them before the per-account thresholds are reached.
  skip: () => envConfig.NODE_ENV === SERVER_ENV.TEST,
});

export default rateLimiter;
