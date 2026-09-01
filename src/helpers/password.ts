import z from "zod";

/**
 * Single source of truth for password policy, shared by every create/set and
 * change/reset password path. The rules mirror the frontend policy in
 * boilerplate-frontend `src/module/auth/utils/form-utils.ts` EXACTLY so a
 * password accepted by one layer is never rejected by the other.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
  )
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/\d/, "Password must contain at least one number")
  // Special-char set is intentionally the frontend's exact set — widening it
  // here would let the backend accept passwords the frontend rejects.
  .regex(
    /[@$%*&?!]/,
    "Password must contain at least one special character (@$%*&?!)",
  );
