import envConfig from "@/config/env";
import { ERROR_CODES } from "@/constants/error-codes";
import { Company } from "@/db/models/company";
import { OTP_PURPOSE } from "@/db/models/otpVerification";
import { IUserDocument, User } from "@/db/models/user";
import { STATUS, USER_TYPE } from "@/enums";
import { JWT_CONFIG, jwtHelper } from "@/helpers/jwt";
import { emitAccountLocked } from "@/modules/auth/helpers/auth-audit.helper";
import {
  clearFailedAttempts,
  evaluateLockState,
  isLoginLockoutEnabled,
  recordFailedAttempt,
} from "@/modules/auth/helpers/lockout.helper";
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
import type { IAuthResponse } from "@/providers/auth/utils/auth.types";
import status from "http-status";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

/**
 * Record one failed credential attempt against the lockout counter and, when it
 * crosses a threshold, emit the account-locked audit entry. No-op when the
 * kill switch is off so disabled behaviour matches the pre-feature flow exactly.
 */
async function registerLoginFailure(email: string): Promise<void> {
  if (!isLoginLockoutEnabled()) return;
  const { trigger } = await recordFailedAttempt(email);
  if (trigger) emitAccountLocked(email, trigger === "TERMINAL");
}

/**
 * Handles the login logic for different types (password, otp)
 */
export async function login(data: TLoginParams): Promise<TLoginResponse> {
  const { email, password, loginType, otp } = data;

  // 0. Reject locked accounts before touching the user record or the provider.
  if (isLoginLockoutEnabled()) {
    const lockState = await evaluateLockState(email);
    if (lockState.locked) {
      return {
        error: lockState.resetRequired
          ? AUTH_RESPONSE_MESSAGES.ACCOUNT_LOCKED_RESET_REQUIRED
          : AUTH_RESPONSE_MESSAGES.ACCOUNT_LOCKED,
        status: status.TOO_MANY_REQUESTS,
        messageCode: lockState.resetRequired
          ? ERROR_CODES.ACCOUNT_LOCKED_RESET_REQUIRED
          : ERROR_CODES.ACCOUNT_LOCKED,
      };
    }
  }

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

      // Authenticate with Auth Provider. A wrong password (and any other auth
      // rejection) surfaces here as a throw, so catch it: record the failed
      // attempt and return 401 rather than letting it bubble to the global
      // handler, which would answer 500 and write an ErrorLogs row.
      let result: IAuthResponse;
      try {
        result = await authService.authenticateWithPassword({
          email,
          password,
        });
      } catch {
        await registerLoginFailure(email);
        return {
          error: AUTH_RESPONSE_MESSAGES.INVALID_CREDENTIALS,
          status: status.UNAUTHORIZED,
        };
      }

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
        await registerLoginFailure(email);
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

  // 7. Credentials are valid and no gate remains — clear the failure counter
  // and mint the session.
  if (isLoginLockoutEnabled()) {
    await clearFailedAttempts(email);
  }

  const { token, refreshToken, permissions } = await generateAuthTokens({
    user: authenticatedUser,
    company: company!,
  });

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
