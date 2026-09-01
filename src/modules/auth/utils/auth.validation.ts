import { OTP_PURPOSE } from "@/db/models/otpVerification";
import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";
import { MFA_RESET_IDENTITY_METHOD } from "@/modules/auth/utils/auth.enum";
import { passwordPolicySchema } from "@/modules/auth/utils/password.constant";
import { validatePhoneNumber } from "@/helpers/common";
import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

const nameSchema = z.object({
  first: z.string().min(1, "First name is required"),
  last: z.string().min(1, "Last name is required"),
});

export const RegisterBodySchema = z.object({
  name: nameSchema,
  email: z.email("Invalid email address"),
  password: passwordPolicySchema,
  oauth: z.enum(SOCIAL_OAUTH_METHOD).optional(),
  referralCode: z.string().optional(),
  inviteToken: z.string().optional(),
});

export const LoginBodySchema = z.object({
  email: z.email("Invalid email address"),
  // Login authenticates an EXISTING credential — it must not enforce the
  // password strength policy, or legacy users with older passwords would be
  // locked out. Presence-only check; strength is enforced on password creation.
  password: z.string().min(1, "Password is required").optional(),
  loginType: z.enum(["otp", "password"]),
  otp: z.string().length(4, "OTP must be 4 digits long").optional(),
});

export const RegisterLoginOauthBodySchema = z.object({
  code: z.string().min(1, "Code is required"),
  oauthProvider: z.enum(SOCIAL_OAUTH_METHOD),
  inviteToken: z.string().optional(),
});

// ====================Validation Schemas ====================

export const RegisterValidationSchema = {
  body: RegisterBodySchema,
} as const;

export const LoginValidationSchema = {
  body: LoginBodySchema,
} as const;

export const RegisterLoginOauthValidationSchema = {
  body: RegisterLoginOauthBodySchema,
} as const;

export const SendResetEmailValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
  }),
} as const;

export const UpdatePasswordValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
    token: z.string().min(1, "Token is required"),
    password: passwordPolicySchema,
  }),
} as const;

export const RequestOtpValidationSchema = {
  body: z.object({
    identifier: z
      .string()
      .min(1, "Identifier (email/phone) is required")
      .refine((value) => {
        const isEmail = z.email().safeParse(value).success;
        const isPhone = validatePhoneNumber(value);
        return isEmail || isPhone;
      }, "Invalid identifier (email/phone)"),
    purpose: z.enum(OTP_PURPOSE),
  }),
} as const;

export const VerifyOtpValidationSchema = {
  body: z.object({
    identifier: z.string().min(1, "Identifier (email/phone) is required"),
    purpose: z.enum(OTP_PURPOSE),
    otp: z.string().min(1, "OTP is required"),
  }),
} as const;

export const TwoFactorEnabledValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
  }),
} as const;

export const TwoFactorVerifyValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
    token: z.string().min(1, "Token is required"),
  }),
} as const;

export const TwoFactorLoginValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
    // Two-factor login authenticates an existing credential — presence only,
    // no strength policy (see LoginBodySchema).
    password: z.string().min(1, "Password is required"),
    token: z.string().min(1, "Token is required"),
  }),
} as const;

export const EmailOnlyValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
  }),
} as const;

export const EmailOtpValidationSchema = {
  body: z.object({
    email: z.email("Invalid email address"),
    otp: z
      .string()
      .min(4, "OTP must be at least 4 characters")
      .max(6, "OTP must be at most 6 characters"),
  }),
} as const;

export const MfaRecoveryValidationSchema = {
  body: z.object({
    code: z
      .string()
      .min(1, "Recovery code is required")
      .transform((value) => value.trim()),
  }),
} as const;

export const VerifyResetRequestValidationSchema = {
  body: z.object({
    method: z.enum(MFA_RESET_IDENTITY_METHOD),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Code must be a 6-digit number"),
  }),
} as const;

// ==================== Validators ====================

const registerUserValidator = validate(
  RegisterValidationSchema,
  validationErrorHandler,
);

const loginUserValidator = validate(
  LoginValidationSchema,
  validationErrorHandler,
);

const registerLoginOauthValidator = validate(
  RegisterLoginOauthValidationSchema,
  validationErrorHandler,
);

const sendResetEmailValidator = validate(
  SendResetEmailValidationSchema,
  validationErrorHandler,
);

const updatePasswordValidator = validate(
  UpdatePasswordValidationSchema,
  validationErrorHandler,
);

const requestOtpValidator = validate(
  RequestOtpValidationSchema,
  validationErrorHandler,
);

const verifyOtpValidator = validate(
  VerifyOtpValidationSchema,
  validationErrorHandler,
);

const twoFactorEnabledValidator = validate(
  TwoFactorEnabledValidationSchema,
  validationErrorHandler,
);

const twoFactorVerifyValidator = validate(
  TwoFactorVerifyValidationSchema,
  validationErrorHandler,
);

const twoFactorLoginValidator = validate(
  TwoFactorLoginValidationSchema,
  validationErrorHandler,
);

const emailOnlyValidator = validate(
  EmailOnlyValidationSchema,
  validationErrorHandler,
);

const emailOtpValidator = validate(
  EmailOtpValidationSchema,
  validationErrorHandler,
);

const mfaRecoveryValidator = validate(
  MfaRecoveryValidationSchema,
  validationErrorHandler,
);

const verifyResetRequestValidator = validate(
  VerifyResetRequestValidationSchema,
  validationErrorHandler,
);

const verifyMagicLinkValidator = validate(
  {
    query: z.object({
      token: z.string().min(1, "Token is required"),
    }),
  },
  validationErrorHandler,
);

const getOauthUrlValidator = validate(
  {
    query: z.object({
      provider: z.enum(SOCIAL_OAUTH_METHOD),
      redirectUrl: z.string().optional(),
    }),
  },
  validationErrorHandler,
);

const getEmailFromInviteTokenValidator = validate(
  {
    params: z.object({
      token: z.string().min(1, "Token is required"),
    }),
  },
  validationErrorHandler,
);

export const authValidators = {
  register: registerUserValidator,
  login: loginUserValidator,
  registerLoginOauth: registerLoginOauthValidator,
  sendResetEmail: sendResetEmailValidator,
  updatePassword: updatePasswordValidator,
  requestOtp: requestOtpValidator,
  verifyOtp: verifyOtpValidator,
  twoFactorEnabled: twoFactorEnabledValidator,
  twoFactorVerify: twoFactorVerifyValidator,
  twoFactorLogin: twoFactorLoginValidator,
  emailOnly: emailOnlyValidator,
  emailOtp: emailOtpValidator,
  mfaRecovery: mfaRecoveryValidator,
  verifyResetRequest: verifyResetRequestValidator,
  verifyMagicLink: verifyMagicLinkValidator,
  getOauthUrl: getOauthUrlValidator,
  getEmailFromInviteToken: getEmailFromInviteTokenValidator,
};
