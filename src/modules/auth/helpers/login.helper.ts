import envConfig from "@/config/env";
import { Company } from "@/db/models/company";
import { OTP_PURPOSE } from "@/db/models/otpVerification";
import { IUserDocument, User } from "@/db/models/user";
import { STATUS, USER_TYPE } from "@/enums";
import { JWT_CONFIG, jwtHelper } from "@/helpers/jwt";
import { verifyOtp } from "@/modules/auth/helpers/otp.helper";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { LOGIN_METHOD } from "@/modules/auth/utils/auth.enum";
import { TLoginParams, TLoginResponse } from "@/modules/auth/utils/auth.types";
import {
  evaluatePasswordRotationState,
  isUserInactiveOrDeleted,
} from "@/modules/auth/utils/auth.util";
import { authService } from "@/providers/auth";
import { workos } from "@/providers/auth/authkit.provider";
import status from "http-status";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

/**
 * Handles the login logic for different types (password, otp)
 */
export async function login(data: TLoginParams): Promise<TLoginResponse> {
  const { email, password, loginType, otp, metadata } = data;

  // 1. Find user
  const userData = await User.findOne({ email }).lean();

  if (!userData) {
    return {
      error: AUTH_RESPONSE_MESSAGES.USER_NOT_FOUND,
      status: status.UNAUTHORIZED,
    };
  }

  if (isUserInactiveOrDeleted(userData)) {
    return {
      error:
        userData.status === STATUS.DELETED
          ? AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED
          : AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED,
      status: status.UNAUTHORIZED,
    };
  }

  // 2. Prevent login if user originally registered via OAuth
  if (userData.oauth) {
    return {
      error: AUTH_RESPONSE_MESSAGES.OAUTH_SIGNUP_REQUIRED.replace(
        "{provider}",
        userData.oauth,
      ),
      status: status.CONFLICT,
    };
  }

  let authenticatedUser: IUserDocument | null;
  let providerMfaRequired = false;

  // 3. Authenticate based on login type
  switch (loginType) {
    case LOGIN_METHOD.PASSWORD: {
      /**
       * PASSWORD LOGIN FLOW
       * 1. Validate password presence
       * 2. Authenticate with WorkOS Authkit
       * 3. Sync local user profile
       */
      if (!password) {
        return {
          error: AUTH_RESPONSE_MESSAGES.PASSWORD_REQUIRED,
          status: status.BAD_REQUEST,
        };
      }

      // Authenticate with Auth Provider
      const result = await authService.authenticateWithPassword({
        email,
        password,
      });

      providerMfaRequired = Boolean(result.mfaRequired);

      // Map external user back to local database user
      authenticatedUser = await User.findOne({
        externalUserId: result.user.id,
      }).lean();
      break;
    }

    case LOGIN_METHOD.OTP: {
      /**
       * OTP LOGIN FLOW
       * Uses the unified OtpVerification collection.
       * The OTP must have been generated via POST /request-otp with purpose=LOGIN.
       */
      if (!otp) {
        return {
          error: AUTH_RESPONSE_MESSAGES.OTP_REQUIRED,
          status: status.BAD_REQUEST,
        };
      }

      const result = await verifyOtp(email, OTP_PURPOSE.LOGIN, otp, false);

      if (!result.success) {
        return {
          error: result.message,
          status: result.statusCode,
        };
      }

      authenticatedUser = userData;
      break;
    }

    default: {
      return {
        error: AUTH_RESPONSE_MESSAGES.INVALID_CREDENTIALS,
        status: status.UNAUTHORIZED,
      };
    }
  }

  // 4. Final verification of authenticated user
  if (!authenticatedUser) {
    return {
      error: AUTH_RESPONSE_MESSAGES.INVALID_CREDENTIALS,
      status: status.UNAUTHORIZED,
    };
  }

  // 5. Check account and company status
  const isSuperAdmin = authenticatedUser.roles === USER_TYPE.SUPER_ADMIN;
  const company = !isSuperAdmin
    ? await Company.findOne({ _id: authenticatedUser.companyRef })
    : null;

  const isAccountDisabled =
    (company && company.companyStatus === STATUS.INACTIVE) ||
    authenticatedUser.status === STATUS.INACTIVE;

  if (isAccountDisabled) {
    return {
      error: AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED,
      status: status.UNAUTHORIZED,
    };
  }

  if (authenticatedUser.status === STATUS.DELETED) {
    return {
      error: AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED,
      status: status.UNAUTHORIZED,
    };
  }

  const rotationState = evaluatePasswordRotationState({
    user: authenticatedUser,
    company,
  });

  const mfa = authenticatedUser.mfa;

  // The auth provider and the local `mfa.enrolled` flag can drift apart, so a
  // challenge from either source counts.
  const requiresMfa =
    loginType === LOGIN_METHOD.PASSWORD &&
    (providerMfaRequired || Boolean(mfa?.enrolled));

  // 6. Gate on MFA before any session token is minted
  if (requiresMfa) {
    // Without a local factor there is no challenge to issue, and falling through
    // here would hand back a full session.
    if (!mfa?.factorId) {
      return {
        error: AUTH_RESPONSE_MESSAGES.MFA_FACTOR_MISSING,
        status: status.UNAUTHORIZED,
      };
    }

    const pendingMfaToken = jwtHelper.generateToken(
      {
        _id: authenticatedUser._id.toString(),
        email: authenticatedUser.email,
      },
      JWT_CONFIG.PENDING_MFA_TOKEN_EXPIRY,
      envConfig.MFA_JWT_TOKEN_SECRET,
    );

    const challenge = await workos.mfa.challengeFactor({
      authenticationFactorId: mfa.factorId,
    });

    return {
      user: authenticatedUser,
      pendingMfaToken,
      mfaChallengeId: challenge.id,
      error: null,
      status: status.OK,
      passwordRotation: rotationState,
    };
  }

  // 7. Generate session token
  const { token, refreshToken, permissions } = await generateAuthTokens(
    {
      user: authenticatedUser,
      company: company!,
    },
    undefined,
    metadata,
  );

  authenticatedUser = {
    ...authenticatedUser,
    permissions,
  };

  return {
    user: authenticatedUser,
    token,
    refreshToken,
    error: null,
    status: status.OK,
  };
}
