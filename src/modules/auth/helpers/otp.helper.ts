import envConfig from "@/config/env";
import { OTP_PURPOSE, OtpVerificationModel } from "@/db/models/otpVerification";
import { User } from "@/db/models/user";
import { USER_TYPE } from "@/enums";
import {
  isDevEnvironment,
  isStaging,
  isTestEmail,
  validatePhoneNumber,
} from "@/helpers/common";
import {
  AUTH_RESPONSE_MESSAGES,
  OTP_CONFIG,
  OTP_EXPIRY_MINUTES,
} from "@/modules/auth/utils/auth.constant";
import {
  TOtpRequestResult,
  TOtpVerifyResult,
} from "@/modules/auth/utils/auth.types";
import { emailService } from "@/providers/email";
import { smsService } from "@/providers/sms";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

// ==================== Utilities ====================

/**
 * Generate a numeric OTP of specified length
 */
export function generateOtp(length: number = OTP_CONFIG.LENGTH): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

/**
 * Calculate OTP expiry date
 */
export function getOtpExpiry(minutes: number = OTP_EXPIRY_MINUTES.LOGIN): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Check if OTP has expired
 */
export function isOtpExpired(expiryDate: Date | string): boolean {
  return Date.now() > new Date(expiryDate).getTime();
}

// ==================== Return Types ====================

// ==================== Helpers ====================

/**
 * Resolve the OTP to send — fixed "1234" in non-production or for test emails.
 */
function resolveOtp(identifier: string, isEmail: boolean): string {
  if (
    isStaging() ||
    isDevEnvironment() ||
    (isEmail && isTestEmail(identifier))
  ) {
    return "1234";
  }
  return generateOtp(OTP_CONFIG.LENGTH);
}

/**
 * Generate and persist a new OTP in the OtpVerification collection.
 * Deletes any previous pending OTPs for the same identifier + purpose.
 * Returns the plain-text OTP so it can be dispatched before hashing occurs.
 */
async function saveOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
  customOtp?: string,
): Promise<string> {
  const otp = customOtp ?? generateOtp(OTP_CONFIG.LENGTH);

  const expiryMinutes =
    purpose === OTP_PURPOSE.SIGNUP
      ? OTP_EXPIRY_MINUTES.SIGNUP
      : OTP_EXPIRY_MINUTES.LOGIN;
  const expiresAt = getOtpExpiry(expiryMinutes);

  // Remove previous active OTPs for this identity + purpose to keep collection clean
  await OtpVerificationModel.deleteMany({
    identifier: identifier.toLowerCase(),
    purpose,
  });

  // pre-save hook on the model hashes otpCode before writing to DB
  await OtpVerificationModel.create({
    identifier: identifier.toLowerCase(),
    otpCode: otp,
    purpose,
    expiresAt,
  });

  return otp;
}

async function sendOtp(identifier: string, otp: string, isEmail: boolean) {
  if (isEmail) {
    // Test addresses are normally rerouted to the SES sandbox inbox. In development
    // the local provider captures mail in memory instead, and E2E specs look the OTP
    // up by its real recipient — so the reroute has to be skipped there.
    const emailTarget =
      !isDevEnvironment() && isTestEmail(identifier)
        ? envConfig.SES_TEST_EMAIL
        : identifier;

    await emailService.sendEmail({
      to: emailTarget,
      subject: `Verification Otp`,
      html: `Your verification otp is ${otp} `,
    });
  } else {
    await smsService.sendVerificationCode(identifier, otp);
  }
}

/**
 * Handles both email and phone, and all OTP_PURPOSE values.
 */
export async function requestOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
): Promise<TOtpRequestResult> {
  const isEmail = identifier.includes("@");

  if (isEmail) {
    // Email + SIGNUP  → validates user does NOT already exist
    if (purpose === OTP_PURPOSE.SIGNUP) {
      const existingUser = await User.findOne({ email: identifier });
      if (existingUser) {
        return {
          success: false,
          message: AUTH_RESPONSE_MESSAGES.USER_ALREADY_EXISTS_EMAIL,
          statusCode: 409,
        };
      }
    }
  } else {
    if (!validatePhoneNumber(identifier)) {
      return {
        success: false,
        message: AUTH_RESPONSE_MESSAGES.INVALID_PHONE_FORMAT,
        statusCode: 422,
      };
    }
    // Phone + LOGIN   → auto-creates a minimal user if none found
    if (purpose === OTP_PURPOSE.LOGIN || purpose === OTP_PURPOSE.VERIFICATION) {
      const existingUser = await User.findOne({ phone: identifier });
      if (!existingUser) {
        await User.create({ phone: identifier, roles: USER_TYPE.USER });
      }
    }
  }

  const otp = await saveOtp(
    identifier,
    purpose,
    resolveOtp(identifier, isEmail),
  );

  await sendOtp(identifier, otp, isEmail);

  return { success: true, message: AUTH_RESPONSE_MESSAGES.OTP_SENT };
}

/**
 * Identical flow to requestOtp (saveOtp removes the old one and creates fresh).
 */
export async function resendOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
): Promise<TOtpRequestResult> {
  return requestOtp(identifier, purpose);
}

/**
 * Verifies the raw OTP against the stored hash, enforces attempt limits and expiry,
 * marks the OTP as used on success, and returns an auth token where applicable.
 */
export async function verifyOtp(
  identifier: string,
  purpose: OTP_PURPOSE,
  rawOtp: string,
  returnToken: boolean = true,
): Promise<TOtpVerifyResult> {
  const isEmail = identifier.includes("@");

  const otpRecord = await OtpVerificationModel.findOne({
    identifier: identifier.toLowerCase(),
    purpose,
  }).sort({ createdAt: -1 });

  if (!otpRecord || otpRecord.isUsed) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
      statusCode: 401,
    };
  }

  if (isOtpExpired(otpRecord.expiresAt)) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.INVALID_OR_EXPIRED_OTP,
      statusCode: 401,
    };
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.OTP_MAX_ATTEMPTS,
      statusCode: 401,
    };
  }

  // Increment attempts before verifying to prevent brute force on valid hash
  otpRecord.attempts += 1;
  await otpRecord.save();

  const isValid = otpRecord.verifyOtp(rawOtp);

  if (!isValid) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.INCORRECT_OTP,
      statusCode: 401,
    };
  }

  // Consume the OTP
  otpRecord.isUsed = true;
  otpRecord.verifiedAt = new Date();
  await otpRecord.save();

  // Email signup: OTP confirmed — caller completes registration separately
  if ((isEmail && purpose === OTP_PURPOSE.SIGNUP) || !returnToken) {
    return {
      success: true,
      message: AUTH_RESPONSE_MESSAGES.OTP_VERIFIED,
      email: identifier,
    };
  }

  // All other flows: look up the user and issue a JWT
  const user = await User.findOne(
    isEmail ? { email: identifier } : { phone: identifier },
  );

  if (!user) {
    return {
      success: false,
      message: AUTH_RESPONSE_MESSAGES.USER_NOT_FOUND_OTP,
      statusCode: 404,
    };
  }

  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
  });

  return {
    success: true,
    message: AUTH_RESPONSE_MESSAGES.OTP_VERIFIED,
    token,
    refreshToken,
    user: { ...user.toObject(), permissions },
  };
}
