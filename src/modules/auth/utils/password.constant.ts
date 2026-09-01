import z from "zod";

// Single source of truth for the backend password policy. Every flow that
// creates/sets/changes/resets a password imports `passwordPolicySchema` so the
// rules can never drift apart again. Kept byte-identical to the frontend policy
// (boilerplate-frontend src/module/auth/utils/form-utils.ts) so a password that
// is valid on the frontend is valid here and vice versa.
export const PASSWORD_MIN_LENGTH = 8;

// Must stay identical to the frontend special-character set.
export const PASSWORD_SPECIAL_CHARACTERS = "@$%*&?!";

export const PASSWORD_POLICY_RULES = {
  upperAndLower: /(?=.*[a-z])(?=.*[A-Z])/,
  number: /\d/,
  special: /[@$%*&?!]/,
} as const;

export const PASSWORD_POLICY_ERROR_MESSAGES = {
  minLength: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
  upperAndLower:
    "Password must contain at least one uppercase and one lowercase letter",
  number: "Password must contain at least one number",
  special: `Password must contain at least one special character (${PASSWORD_SPECIAL_CHARACTERS})`,
} as const;

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_POLICY_ERROR_MESSAGES.minLength)
  .regex(
    PASSWORD_POLICY_RULES.upperAndLower,
    PASSWORD_POLICY_ERROR_MESSAGES.upperAndLower,
  )
  .regex(PASSWORD_POLICY_RULES.number, PASSWORD_POLICY_ERROR_MESSAGES.number)
  .regex(PASSWORD_POLICY_RULES.special, PASSWORD_POLICY_ERROR_MESSAGES.special);
