import apiConfig from "@/config/api";
import envConfig from "@/config/env";
import { SERVER_ENV } from "@/enums";
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
 * Tighter per-IP limit for the login endpoint. The in-memory store persists for
 * the whole window, so it is skipped under test — the suites drive many logins
 * per IP and the account-lockout logic is what those specs exercise.
 */
export const loginRateLimiter = rateLimit({
  windowMs: apiConfig.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: apiConfig.LOGIN_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: apiConfig.LOGIN_RATE_LIMIT_MESSAGE,
  skip: () => envConfig.NODE_ENV === SERVER_ENV.TEST,
});

export default rateLimiter;
