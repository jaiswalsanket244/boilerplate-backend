export const USER_RESPONSE_MESSAGES = {
  PROFILE_UPDATED: "Your profile has been updated successfully!",
  PASSWORD_CHANGED: "Your Password has been changed successfully",
  PROFILE_UPDATE_SUCCESS: "User profile updated successfully",
  PASSWORD_CHANGE_SUCCESS: "Changed password successfully",
  UNAUTHORIZED: "Unauthorized",
  INVALID_PASSWORD: "Invalid Password.",
  PASSWORD_UPDATE_FAILED: "Failed to update password",
  USER_FETCH_SUCCESS: "Success.",
  USER_FETCH_ERROR: "Error.",
  DATA_FETCHED: "Dashboard data fetched successfully.",
  COMPANY_REF_REQUIRED: "Company ref is required.",
  DATA_UPDATED_SUCCESS: "Data updated successfully.",
  ACCOUNT_DELETED: "Your account has been deleted.",
  SOLE_ADMIN_CANNOT_DELETE:
    "You are the only admin of your company. Make another member an admin before deleting your account.",
  SUPER_ADMIN_CANNOT_DELETE: "Super admin accounts cannot be self-deleted.",
} as const;
