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
 * Stricter per-IP limit for the login endpoint specifically. The site-wide
 * limiter still applies; this adds a tighter cap so credential-guessing traffic
 * against one address is throttled well before it reaches the account lockout.
 * Skipped under test so suites can drive many login attempts deterministically.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: apiConfig.RATE_LIMIT_DEFAULT_MESSAGE,
  skip: () => envConfig.NODE_ENV === SERVER_ENV.TEST,
});

export default rateLimiter;
