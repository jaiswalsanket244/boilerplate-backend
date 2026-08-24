import { IAuthProviderUser } from "@/providers/auth/utils/auth.types";

/**
 * WorkOS throws 403 `mfa_challenge` when a factor is enrolled — the password was
 * accepted, so the payload carries the authenticated user. `rawData` is the untouched
 * HTTP body, hence snake_case rather than the SDK's camelCase.
 */
export function parseMfaChallenge(error: unknown): IAuthProviderUser | null {
  const rawData = (error as { rawData?: Record<string, any> })?.rawData;

  if (rawData?.code !== "mfa_challenge" || !rawData?.user?.id) return null;

  const user = rawData.user;

  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    emailVerified: user.email_verified,
    metadata: user.metadata,
  };
}
