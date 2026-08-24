import { TErrorCode } from "@/constants/error-codes";
import { IUser, IUserDocument } from "@/db/models/user";
import { COOKIE_NAME } from "@/enums";
import { MFA_RESET_IDENTITY_METHOD } from "@/modules/auth/utils/auth.enum";
import {
  authValidators,
  RegisterBodySchema,
  LoginBodySchema,
  RegisterLoginOauthBodySchema,
} from "@/modules/auth/utils/auth.validation";
import { CookieOptions, Response } from "express";
import z from "zod";

export type TAuthController = typeof authValidators;

export type TUpdatePasswordResult =
  | { success: true; user: IUserDocument | null }
  | {
      success: false;
      status: number;
      message: string;
      messageCode?: TErrorCode;
    };

export type TLoginResponse =
  | {
      error: string;
      status: number;
      user?: never;
      token?: never;
      pendingMfaToken?: never;
      passwordRotation?: never;
      mfaChallengeId?: never;
      refreshToken?: never;
    }
  | {
      error: null;
      status: number;
      user: IUser;
      token?: string | null;
      refreshToken?: string;
      pendingMfaToken?: string | null;
      passwordRotation?: TPasswordRotationState;
      mfaChallengeId?: string;
    };

export type TRegisterParams = z.infer<typeof RegisterBodySchema>;
export type TLoginParams = z.infer<typeof LoginBodySchema> & {
  res: Response;
};
export type TRegisterLoginOauthParams = z.infer<
  typeof RegisterLoginOauthBodySchema
>;

export type TOtpVerifyResult =
  | {
      success: true;
      message: string;
      email?: string;
      token?: string;
      refreshToken?: string;
      user?: IUser;
      warning?: TErrorCode;
      daysLeft?: number;
    }
  | { success: false; message: string; statusCode: number };

export type TOtpRequestResult =
  | { success: true; message: string }
  | { success: false; message: string; statusCode: number };

export type TVerifyResetResult =
  { success: true } | { success: false; message: string; statusCode: number };

export interface IAuthCookies {
  token: string;
  refreshToken?: string;
  user?: IUser;
}

export type TSetCookieParams = {
  cookieName: COOKIE_NAME;
  value: string;
  httpOnly?: boolean;
  options?: CookieOptions;
};

export type TPasswordRotationConfig = {
  rotatePassword: boolean;
  passwordValidityDays: number;
  passwordGraceDays: number;
};

export type TPasswordRotationState = {
  isBlocked: boolean;
  errorCode?: TErrorCode;
  daysLeft?: number;
};

export type TVerifyMfaSetupParams = {
  email: string;
  userId: string;
  challengeId: string;
  code: string;
  factorId: string;
  user?: IUser;
};

export type TVerifyMfaChallengeParams = Omit<TVerifyMfaSetupParams, "factorId">;

export type TVerifyMfaSetupResponse =
  | {
      message: string;
      statusCode: number;
      error: true;
      token?: never;
      refreshToken?: never;
      recoveryCodes?: never;
      user?: never;
    }
  | {
      message: string;
      statusCode: number;
      error: false;
      token: string;
      refreshToken: string;
      recoveryCodes: string[];
      user: IUser;
    };
export type TVerifyMfaChallengeResponse =
  | {
      message: string;
      statusCode: number;
      error: true;
      token?: never;
      refreshToken?: never;
    }
  | {
      message: string;
      statusCode: number;
      error: false;
      token: string;
      refreshToken: string;
    };
export type TSkipMfaResponse =
  | {
      message: string;
      statusCode: number;
      error: true;
      token?: never;
      refreshToken?: never;
      user?: never;
    }
  | {
      message: string;
      statusCode: number;
      error: false;
      token: string;
      refreshToken: string;
      user: IUser;
    };

export type TVerifyResetRequestParams = {
  email: string;
  code: string;
  method: MFA_RESET_IDENTITY_METHOD;
  factorId: string;
};
