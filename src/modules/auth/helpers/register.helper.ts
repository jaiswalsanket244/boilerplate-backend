import envConfig from "@/config/env";
import status from "http-status";
import { Company, ICompany } from "@/db/models/company";
import { IInvitedUsers, InvitedUsers } from "@/db/models/invitedUsers";
import { IUser, User } from "@/db/models/user";
import { USER_TYPE, INVITED_USER_STATUS, STATUS } from "@/enums";
import { AppError } from "@/helpers/app-error";
import { JWT_CONFIG, jwtHelper } from "@/helpers/jwt";
import {
  AUTH_RESPONSE_MESSAGES,
  MFA_ENROLLMENT_REQUIRED_AT_SIGNUP,
} from "@/modules/auth/utils/auth.constant";
import {
  TRegisterLoginOauthParams,
  TRegisterParams,
} from "@/modules/auth/utils/auth.types";
import {
  buildPasswordTimestamps,
  getPasswordRotationConfig,
} from "@/modules/auth/utils/auth.util";
import { referralsHelper } from "@/modules/referrals/helpers/referrals.helper";
import { authService } from "@/providers/auth";
import { workos } from "@/providers/auth/authkit.provider";
import { isUserInactiveOrDeleted } from "@/modules/auth/utils/auth.util";
import { validateInvitation } from "@/modules/auth/helpers/invite.helper";
import { generateAuthTokens } from "@/modules/auth/helpers/token.helper";

async function syncWithAuthProvider({
  user,
  password,
  createOrganization,
  createUser = true,
  company,
}: {
  password: string;
  user: IUser;
  company: ICompany;
  createUser?: boolean;
  createOrganization?: boolean;
}) {
  let externalUserId = user.externalUserId ?? "";

  if (createUser) {
    /**
     1. Create the user in the external auth provider and get the externalUserId.
     externalId links the provider record back to the local user id — it powers
     getUserByExternalId, used by the delete-sync change stream.
     */
    const authProviderUser = await authService.createUser({
      email: user.email,
      password: password,
      firstName: user.name.first,
      lastName: user.name.last,
      emailVerified: true,
      externalId: user._id.toString(),
    });
    externalUserId = authProviderUser.id;

    // 2. Update the DB user record with the externalUserId and companyRef
    await User.findByIdAndUpdate(user._id, {
      externalUserId,
    });
  }

  let workosOrgId: string | undefined = company.externalId;

  // 3. Create a organization in WorkOS  if companyId is provided and user is an admin, and link the auth provider user to the organization
  if (createOrganization && !workosOrgId) {
    const workosOrg = await workos.organizations.createOrganization({
      name: user.email,
      externalId: company._id.toString(),
    });

    await Company.updateOne({ _id: company._id }, { externalId: workosOrg.id });
    workosOrgId = workosOrg.id;
  }

  if (workosOrgId) {
    // assign role to user
    const membership = await workos.userManagement.createOrganizationMembership(
      {
        organizationId: workosOrgId,
        roleSlug:
          user.roles === USER_TYPE.ADMIN ? USER_TYPE.ADMIN : USER_TYPE.USER,
        userId: externalUserId,
      },
    );

    await User.findByIdAndUpdate(user._id, {
      organizationMembershipId: membership.id,
    });
  }
}

/**
 * Handles standard email/password registration
 * @param data - Registration details including email, password, name, and optional referral/invite tokens
 * @returns Object containing the created user and their session token
 */
export async function register(data: TRegisterParams) {
  const { email, password, name, referralCode, inviteToken } = data;

  // 1. Validate invitation if an invite token is provided
  let invitation: IInvitedUsers | null = null;
  if (inviteToken) {
    invitation = await validateInvitation({ inviteToken, email });
  }

  const isInvite = !!invitation;
  const userRole = isInvite && invitation ? invitation.role : USER_TYPE.ADMIN;
  let companyRef = invitation?.companyRef;
  let companyConfig: {
    rotatePassword: boolean;
    passwordValidityDays: number;
    passwordGraceDays: number;
  } | null = null;

  // 2. Create a new company if the user is an Admin and not joining via invitation
  const shouldCreateCompany = !companyRef && userRole === USER_TYPE.ADMIN;
  let company: ICompany | undefined | null = undefined;
  if (shouldCreateCompany) {
    const createdCompany = await Company.create({ name: email });
    await createdCompany.save();

    companyRef = createdCompany._id;
    company = createdCompany;

    companyConfig = getPasswordRotationConfig(createdCompany);
  } else if (companyRef) {
    company = await Company.findById(companyRef);

    companyConfig = getPasswordRotationConfig(company ?? null);
  }

  const passwordTimestamps = password
    ? buildPasswordTimestamps(companyConfig?.passwordValidityDays)
    : {};

  const hasPassword = !!password;

  // 3. Create local user record
  const user = await User.create({
    email,
    name,
    hasPassword,
    ...passwordTimestamps,
    companyRef,
    mfa: {
      enrolled: false,
    },
    roles: userRole,
  });

  // 4. Link company back to the admin user
  if (companyRef && userRole === USER_TYPE.ADMIN) {
    await Company.findByIdAndUpdate(companyRef, { userRef: user._id });
  }

  // 5. Update invitation status if applicable
  if (isInvite) {
    await InvitedUsers.updateOne(
      { invitedEmail: email },
      { status: INVITED_USER_STATUS.ACCEPTED },
    );
  }

  // 6. Apply referral rewards if a referral code was used
  if (referralCode) {
    await referralsHelper.applyReferralCode(user._id, referralCode);
  }

  //7. Sync user to external auth provider and create organization in WorkOS if needed
  await syncWithAuthProvider({
    user,
    password: password || "",
    createOrganization: shouldCreateCompany,
    company: company as ICompany,
  });

  //8. if mfa is required then generate a temporary token for MFA enrollment instead of logging in the user directly
  if (MFA_ENROLLMENT_REQUIRED_AT_SIGNUP) {
    const pendingMfaToken = jwtHelper.generateToken(
      {
        _id: user._id.toString(),
        email: user.email,
      },
      JWT_CONFIG.PENDING_MFA_TOKEN_EXPIRY,
      envConfig.MFA_JWT_TOKEN_SECRET,
    );
    return { user, pendingMfaToken };
  }

  //9. Generate JWT session token
  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
  });

  return { user: { ...user.toObject(), permissions }, token, refreshToken };
}

/**
 * Handles social registration and login (OAuth)
 * @param data - Contains the OAuth code, provider name, and optional invite token
 * @returns Object containing the user and their session token
 */
export async function registerLoginOauth(data: TRegisterLoginOauthParams) {
  const { code, oauthProvider, inviteToken } = data;

  // 1. Authenticate with Auth Provider using the OAuth code
  const result = await authService.authenticateWithCode(code);
  const authProviderUser = result.user;

  if (!authProviderUser) {
    throw new Error("Something went wrong during social authentication!");
  }

  const firstName = authProviderUser.firstName || "USER";
  const lastName = authProviderUser.lastName || "BYLDD";
  const email = authProviderUser.email;

  // 2. Check if user already exists in local DB
  let user = await User.findOne({ email });

  if (user && isUserInactiveOrDeleted(user)) {
    throw new AppError(
      user.status === STATUS.DELETED
        ? AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED
        : AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED,
      status.UNAUTHORIZED,
    );
  }

  let company: ICompany | undefined | null = user?.companyRef
    ? await Company.findById(user.companyRef)
    : null;
  // 3. If user doesn't exist, create a new record (Registration flow for Social Login)
  if (!user) {
    let invitation: IInvitedUsers | null = null;

    // Validate invitation if an invite token is provided
    if (inviteToken) {
      invitation = await validateInvitation({ inviteToken, email });
    }

    const isInvite = !!invitation;
    const userRole = isInvite && invitation ? invitation.role : USER_TYPE.ADMIN;
    let companyRef = invitation?.companyRef;

    const shouldCreateCompany = !companyRef && userRole === USER_TYPE.ADMIN;
    // Create company for new Admin users
    if (shouldCreateCompany) {
      const createdCompany = await Company.create({ name: email });
      company = createdCompany;

      await createdCompany.save();

      companyRef = createdCompany._id;
    }

    // Create local user profile
    user = await User.create({
      email,
      oauth: oauthProvider?.toUpperCase(),
      name: { first: firstName, last: lastName },
      externalUserId: authProviderUser.id,
      companyRef,
      roles: userRole,
    });

    //

    // Link company to admin
    await Company.findByIdAndUpdate(companyRef, { userRef: user._id });

    // Sync OAuth provider metadata back to Auth Provider
    if (oauthProvider) {
      await authService.updateUser({
        userId: authProviderUser.id,
        externalId: user._id.toString(),
        metadata: {
          ...authProviderUser.metadata,
          OAuthProvider: oauthProvider,
        },
      });
    }
    await syncWithAuthProvider({
      user,
      password: "",
      createOrganization: shouldCreateCompany,
      createUser: false,
      company: company as ICompany,
    });
  } else if (company && !company.externalId) {
    // Existing user whose company was never synced to WorkOS: create/link the org now so token generation (which requires externalId) can succeed.
    await syncWithAuthProvider({
      user,
      password: "",
      createOrganization: true,
      createUser: false,
      company,
    });
  }

  // 4. Generate JWT session token
  const { token, refreshToken, permissions } = await generateAuthTokens({
    user,
  });

  return { user: { ...user.toObject(), permissions }, token, refreshToken };
}
