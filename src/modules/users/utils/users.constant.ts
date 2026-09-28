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
} as const;

/*
 * Explicit allow-list for the admin CSV export. Never widen this to secrets
 * (password, token, twoFaSecret, qrCode, cardTokens, mfa, stripe ids).
 */
export const USER_EXPORT_FIELDS =
  "name email phone roles status forcePasswordChange lastActivity createdAt updatedAt";

export const USER_EXPORT_CSV_COLUMNS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "phone",
  "role",
  "status",
  "forcePasswordChange",
  "lastActivity",
  "createdAt",
  "updatedAt",
] as const;
