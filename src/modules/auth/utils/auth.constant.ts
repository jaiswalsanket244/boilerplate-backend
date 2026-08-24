import { USER_TYPE } from "@/enums";

/**
 * OTP expiry durations in minutes
 */
export const OTP_EXPIRY_MINUTES = {
  LOGIN: 5,
  SIGNUP: 10,
  PHONE: 5,
  MFA_RESET: 5,
} as const;

/**
 * OTP configuration
 */
export const OTP_CONFIG = {
  LENGTH: 4,
  MIN_LENGTH: 4,
  MAX_LENGTH: 6,
} as const;

/**
 * Referral configuration
 */
export const REFERRAL_CONFIG = {
  SIGNUP_POINTS: 500,
  REFEREE_SIGNUP_POINTS: 200,
} as const;

export const AUTH_RESPONSE_MESSAGES = {
  // Invite / token
  EMAIL_RETRIEVED: "Email retrieved successfully!",
  TOKEN_EXPIRED:
    "Your Token is expired. Kindly ask for resend the invitation again!",
  INVALID_TOKEN: "Invalid or expired invite token",
  ALREADY_ACCEPTED: "You have already accepted an invitation.",
  EMAIL_NOT_INVITED: "Your email is not invited.",
  INVITATION_CANCELLED: "The invitation has been cancelled.",
  ACCEPT_INVITE_FAILED: "Accept invite failed",

  // Auth / login
  USER_NOT_FOUND: "Your account doesn't exist, please signup",
  OAUTH_SIGNUP_REQUIRED: "You have registered through {provider}!",
  PASSWORD_REQUIRED: "Password is required for password login",
  INVALID_CREDENTIALS: "Invalid credentials",
  ACCOUNT_DISABLED: "Your account is disabled",
  ACCOUNT_DELETED: "Your account has been deleted",
  MFA_FACTOR_MISSING:
    "Multi-factor authentication is required but no factor is registered on this account. Please contact support.",
  ACCOUNT_LOCKED:
    "Too many failed attempts. This account is temporarily locked. Please try again later.",
  ACCOUNT_LOCKED_RESET_REQUIRED:
    "Too many failed attempts. This account is locked — reset your password to regain access.",

  // OTP
  OTP_REQUIRED: "OTP is required for OTP login",
  OTP_SENT: "OTP sent successfully.",
  OTP_RESENT: "OTP resent successfully.",
  OTP_VERIFIED: "OTP verified successfully.",

  INVALID_OR_EXPIRED_OTP: "Invalid or expired OTP.",
  INCORRECT_OTP: "Incorrect OTP. Please try again.",
  OTP_MAX_ATTEMPTS: "Maximum OTP attempts reached. Please request a new OTP.",
  INVALID_PHONE_FORMAT:
    "Phone number must be in E.164 format (e.g. +911234567890).",
  USER_ALREADY_EXISTS_EMAIL: "User already exists with this email address.",
  USER_NOT_FOUND_OTP: "User not found.",
} as const;

/**
 * Account-lockout thresholds for repeated failed logins.
 *
 * The counter is monotonic and never decays with time — it is cleared only by a
 * successful login or a successful password reset. A locked account short-circuits
 * the login flow before the auth provider is ever called.
 *
 *   failedCount  →  effect
 *   1–4             allowed
 *   5               locked for FIRST.lockMinutes
 *   10              locked for SECOND.lockMinutes
 *   15              terminal lock — cleared by password reset only
 */
export const LOGIN_LOCKOUT = {
  FIRST: { at: 5, lockMinutes: 5 },
  SECOND: { at: 10, lockMinutes: 30 },
  TERMINAL: { at: 15 },
  /**
   * Housekeeping TTL for non-terminal records (minutes). Only reclaims abandoned
   * rows long after every timed lock has elapsed; it is intentionally far larger
   * than SECOND.lockMinutes so it never shortens an active lock.
   */
  RECORD_TTL_MINUTES: 24 * 60,
} as const;

export const DEFAULT_PASSWORD_VALIDITY_DAYS = 90;
export const DEFAULT_PASSWORD_GRACE_DAYS = 7;

export const MFA_ENROLLMENT_REQUIRED_AT_SIGNUP = true;

export const MFA_REQUIRED_ROLES = [
  USER_TYPE.ADMIN,
  USER_TYPE.SUPER_ADMIN,
  USER_TYPE.USER,
];
