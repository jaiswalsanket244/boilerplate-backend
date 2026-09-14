import { RefreshToken } from "@/db/models/refreshToken";
import {
  ISessionDTO,
  TRevokeSessionOutcome,
} from "@/modules/auth/utils/session.types";
import { toSessionDTO } from "@/modules/auth/utils/session.util";
import mongoose from "mongoose";

/**
 * List the caller's active sessions, most-recently-active first, with the
 * current session flagged. Never returns the raw token value.
 */
export async function listUserSessions(
  userId: mongoose.Types.ObjectId | string,
  currentSessionId?: string,
): Promise<ISessionDTO[]> {
  const rows = await RefreshToken.find({ userId })
    .sort({ lastActiveAt: -1 })
    .lean();

  return rows.map((row) => toSessionDTO(row, currentSessionId));
}

/**
 * Revoke one owned, non-current session. Returns an outcome so the controller
 * can map it to the right status: `current` -> 400 (use normal logout),
 * `not_found` -> 404 (not the caller's session, no cross-user access).
 */
export async function revokeUserSession(
  userId: mongoose.Types.ObjectId | string,
  sessionId: string,
  currentSessionId?: string,
): Promise<TRevokeSessionOutcome> {
  if (currentSessionId && sessionId === currentSessionId) {
    return "current";
  }

  const result = await RefreshToken.deleteMany({ userId, sessionId });

  return result.deletedCount > 0 ? "revoked" : "not_found";
}

/**
 * Delete every one of the caller's sessions except the current one and return
 * how many were removed. A missing currentSessionId would make `$ne` match
 * nothing meaningful, so we guard the caller against wiping their own session.
 */
export async function revokeOtherSessions(
  userId: mongoose.Types.ObjectId | string,
  currentSessionId: string,
): Promise<number> {
  const result = await RefreshToken.deleteMany({
    userId,
    sessionId: { $ne: currentSessionId },
  });

  return result.deletedCount ?? 0;
}
