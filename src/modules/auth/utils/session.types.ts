/**
 * Client-facing shape of an active session. Intentionally free of the refresh
 * token value and any internal fields — sessions are identified only by `id`
 * (the durable `sessionId`).
 */
export interface ISessionDTO {
  id: string;
  device: string;
  browser: string;
  os: string;
  ipDisplay: string;
  lastActiveAt: Date | null;
  createdAt: Date;
  isCurrent: boolean;
}

export type TRevokeSessionOutcome = "revoked" | "not_found" | "current";
