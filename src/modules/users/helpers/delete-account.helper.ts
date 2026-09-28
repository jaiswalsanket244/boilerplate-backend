// Self-service account deletion: anonymises the user in place (status DELETED)
// and releases their email in the auth provider so it can register again.
import { Company } from "@/db/models/company";
import { RefreshToken } from "@/db/models/refreshToken";
import { Subscription } from "@/db/models/subscription";
import { User } from "@/db/models/user";
import { STATUS, USER_TYPE } from "@/enums";
import { DELETE_ACCOUNT_RESULT } from "@/modules/users/utils/users.enum";
import { IUserWithCompany } from "@/modules/users/utils/users.types";
import { authService } from "@/providers/auth";
import { paymentGateway } from "@/providers/payment";

/**
 * Providers wrap SDK errors with { cause }, so walk the chain. A "not found"
 * means an earlier, partially failed deletion already removed the record.
 */
function isNotFoundError(error: unknown): boolean {
  for (
    let current: unknown = error;
    current;
    current = (current as { cause?: unknown }).cause
  ) {
    const message =
      current instanceof Error ? current.message : String(current);
    if (
      /not.?found|no such|resource_missing/i.test(message) ||
      (current as { status?: number }).status === 404
    ) {
      return true;
    }
  }
  return false;
}

async function ignoreNotFound(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

/**
 * A sole admin may only leave once nobody else is in the company; otherwise
 * the remaining members would have no one able to manage it.
 */
async function isBlockedAsSoleAdmin(user: IUserWithCompany) {
  if (user.roles !== USER_TYPE.ADMIN || !user.companyRef) return false;

  const otherMembers = {
    companyRef: user.companyRef,
    _id: { $ne: user._id },
    status: { $ne: STATUS.DELETED },
  };
  const [otherAdmins, otherUsers] = await Promise.all([
    User.countDocuments({ ...otherMembers, roles: USER_TYPE.ADMIN }),
    User.countDocuments(otherMembers),
  ]);

  return otherAdmins === 0 && otherUsers > 0;
}

/** Stops future renewals; the company keeps access until the paid period ends. */
async function cancelPaidSubscriptions(user: IUserWithCompany) {
  const subscriptions = await Subscription.find({
    userRef: user._id,
    status: { $in: [STATUS.ACTIVE, STATUS.PAST_DUE] },
    subscriptionCancellationRequested: { $ne: true },
    stripeSubscriptionId: { $exists: true, $ne: null },
  });

  for (const subscription of subscriptions) {
    await paymentGateway.cancelSubscription(subscription.stripeSubscriptionId!);
    await Subscription.updateOne(
      { _id: subscription._id },
      { subscriptionCancellationRequested: true },
    );
  }
}

/**
 * Order matters: external steps (Stripe, auth provider) run before the local
 * anonymisation so a failure leaves the account intact and the request can be
 * retried. Every step is safe to repeat.
 */
export async function deleteOwnAccount(
  user: IUserWithCompany,
): Promise<DELETE_ACCOUNT_RESULT> {
  if (user.roles === USER_TYPE.SUPER_ADMIN) {
    return DELETE_ACCOUNT_RESULT.SUPER_ADMIN_NOT_ALLOWED;
  }
  if (await isBlockedAsSoleAdmin(user)) {
    return DELETE_ACCOUNT_RESULT.SOLE_ADMIN;
  }

  await cancelPaidSubscriptions(user);

  // The auth provider holds its own copy of the email; while it exists,
  // registering again with the same address is rejected there.
  if (user.organizationMembershipId) {
    await ignoreNotFound(() =>
      authService.deleteOrganizationMembership(user.organizationMembershipId!),
    );
  }
  if (user.externalUserId) {
    await ignoreNotFound(() => authService.deleteUser(user.externalUserId!));
  }

  const anonymisedId = user._id.toString();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        status: STATUS.DELETED,
        email: `deleted-${anonymisedId}@deleted.invalid`,
        name: { first: "Deleted", last: "User" },
        ...(user.phone ? { phone: `deleted-${anonymisedId}` } : {}),
      },
      // Both are unique indexes pointing at provider records that no longer exist.
      $unset: { externalUserId: "", organizationMembershipId: "" },
    },
  );
  await RefreshToken.deleteMany({ userId: user._id });

  if (user.companyRef) {
    const remainingMembers = await User.countDocuments({
      companyRef: user.companyRef,
      status: { $ne: STATUS.DELETED },
    });
    if (remainingMembers === 0) {
      await Company.updateOne(
        { _id: user.companyRef },
        { companyStatus: STATUS.DELETED },
      );
    }
  }

  return DELETE_ACCOUNT_RESULT.DELETED;
}
