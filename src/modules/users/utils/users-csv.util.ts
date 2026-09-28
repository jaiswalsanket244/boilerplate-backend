import type { IUserDocument } from "@/db/models/user";
import { toCsv } from "@/helpers/csv";
import { USER_EXPORT_CSV_COLUMNS } from "@/modules/users/utils/users.constant";

type TExportUser = Pick<
  IUserDocument,
  | "_id"
  | "name"
  | "email"
  | "phone"
  | "roles"
  | "status"
  | "forcePasswordChange"
  | "lastActivity"
  | "createdAt"
  | "updatedAt"
>;

function userToCsvValues(user: TExportUser): unknown[] {
  return [
    user._id,
    user.name?.first,
    user.name?.last,
    user.email,
    user.phone,
    user.roles,
    user.status,
    user.forcePasswordChange ?? false,
    // lastActivity is stored as epoch millis.
    user.lastActivity ? new Date(user.lastActivity) : null,
    user.createdAt,
    user.updatedAt,
  ];
}

export function serializeUsersCsv(users: TExportUser[]): string {
  return toCsv(USER_EXPORT_CSV_COLUMNS, users.map(userToCsvValues));
}
