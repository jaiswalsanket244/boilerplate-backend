import z from "zod";

// Canonical password-strength policy — the single source of truth for the
// backend, mirrored exactly by the frontend. Apply this to every create/set and
// change/reset flow. Login must NOT use it: login validates existing/legacy
// passwords and enforcing strength there could lock users out.
export const PASSWORD_MIN_LENGTH = 8;

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
  )
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  // A special character is defined as any non-alphanumeric character.
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character",
  );
