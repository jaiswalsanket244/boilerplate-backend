import { Company, ICompany } from "@/db/models/company";
import { RefreshToken } from "@/db/models/refreshToken";
import { IUser } from "@/db/models/user";
import { jwtHelper } from "@/helpers/jwt";
import { workos } from "@/providers/auth/authkit.provider";
import { SignOptions } from "jsonwebtoken";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { LOGIN_METHOD } from "@/modules/auth/utils/auth.enum";

/**
 * Device/session metadata threaded into a session at creation. Every field is
 * optional: non-HTTP or legacy call sites omit them and safe defaults apply.
 */
export type TSessionMetadata = {
  sessionId?: string;
  userAgent?: string;
  ip?: string;
};

/**
 * Build a fresh refresh-token string and its expiry. Kept as the single source
 * of the token format (80-char hex, 7-day default) so rotation reuses it.
 */
export function buildRefreshTokenValue(expiresInDays: number = 7): {
  token: string;
  expiresAt: Date;
} {
  const token = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  return { token, expiresAt };
}

/**
 * Generate a new refresh token and save it to the database
 * @param userId User's ID
 * @param metadata Durable sessionId + device metadata to persist on the row
 * @param expiresInDays Number of days the token is valid for
 * @returns The generated plain text token
 */
export async function generateAndSaveRefreshToken(
  userId: mongoose.Types.ObjectId | string,
  metadata: TSessionMetadata = {},
  expiresInDays: number = 7,
): Promise<string> {
  const { token, expiresAt } = buildRefreshTokenValue(expiresInDays);

  await RefreshToken.create({
    userId: userId,
    token,
    expiresAt,
    sessionId: metadata.sessionId ?? crypto.randomUUID(),
    userAgent: metadata.userAgent ?? "unknown",
    ip: metadata.ip ?? "unknown",
    lastActiveAt: new Date(),
  });

  return token;
}

/**
 * Resolve a user's role (and thus permissions) from WorkOS, honouring the
 * org-vs-environment role split. Shared by token minting and session refresh.
 */
export async function resolveUserRole(user: IUser) {
  const company = await Company.findById(user.companyRef);

  if (!company || !company.externalId) {
    throw new Error(
      "Failed to generate auth tokens: Company not found or externalId missing.",
    );
  }

  if (user.roles.startsWith("org") && company.externalId) {
    return workos.authorization.getOrganizationRole(
      company.externalId,
      user.roles,
    );
  }
  return workos.authorization.getEnvironmentRole(user.roles);
}

/**
 * Mint a signed access token carrying the durable sessionId claim, which lets
 * mobile clients (no refresh cookie on GETs) identify their current session.
 */
export async function generateAccessToken(
  data: { user: IUser; loginMethod?: LOGIN_METHOD; company?: ICompany },
  sessionId: string,
  options?: { exp?: SignOptions["expiresIn"] },
) {
  const { user, loginMethod } = data;
  const role = await resolveUserRole(user);

  const token = jwtHelper.generateToken(
    {
      _id: user._id.toString(),
      email: user.email,
      orgId: user.companyRef?.toString(),
      permissions: role.permissions,
      loginMethod,
      sessionId,
    },
    options?.exp,
  );

  return { token, permissions: role.permissions };
}

export async function generateAuthTokens(
  data: { user: IUser; loginMethod?: LOGIN_METHOD; company?: ICompany },
  options?: {
    exp?: SignOptions["expiresIn"];
  },
  metadata?: TSessionMetadata,
) {
  const { user } = data;

  const sessionId = metadata?.sessionId ?? crypto.randomUUID();
  const { token, permissions } = await generateAccessToken(
    data,
    sessionId,
    options,
  );

  const refreshToken = await generateAndSaveRefreshToken(user._id, {
    sessionId,
    userAgent: metadata?.userAgent,
    ip: metadata?.ip,
  });

  return { token, refreshToken, permissions, sessionId };
}

/**
 * Revoke a refresh token by deleting it from the database
 * @param token The refresh token string
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await RefreshToken.deleteOne({ token });
}
