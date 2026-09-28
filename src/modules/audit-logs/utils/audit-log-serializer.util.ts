import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import { scrubSensitiveKeys } from "@/db/plugins/audit/utils/sensitive-keys";
import { toCsv } from "@/helpers/csv";
import type {
  AuditExportFormat,
  ISerializedAuditLogs,
} from "@/modules/audit-logs/utils/audit-log.types";

/*
 * Fixed, explicit CSV column order. Do NOT derive from Object.keys of a row —
 * rows have sparse optional fields, so column order must be stable across rows.
 */
const CSV_COLUMNS = [
  "_id",
  "timestamp",
  "category",
  "action",
  "status",
  "actorId",
  "actorEmail",
  "actorName",
  "targetType",
  "targetId",
  "target",
  "companyRef",
  "context",
  "changes",
  "metadata",
  "_sig",
] as const;

function rowToCsvValues(row: IAuditLog): unknown[] {
  return [
    row._id,
    row.timestamp,
    row.category,
    row.action,
    row.status,
    row.actorId,
    row.actorEmail,
    row.actor?.name ?? null,
    row.targetType,
    row.targetId,
    row.target,
    row.companyRef,
    row.context,
    row.changes,
    row.metadata,
    row._sig,
  ];
}

export function serializeAuditLogs(
  rows: IAuditLog[],
  format: AuditExportFormat,
): ISerializedAuditLogs {
  const safeRows = rows.map((row) => scrubSensitiveKeys(row) as IAuditLog);

  if (format === "csv") {
    const csv = toCsv(CSV_COLUMNS, safeRows.map(rowToCsvValues));
    return {
      body: Buffer.from(csv, "utf-8"),
      mimeType: "text/csv",
      ext: "csv",
    };
  }

  return {
    body: Buffer.from(JSON.stringify(safeRows), "utf-8"),
    mimeType: "application/json",
    ext: "json",
  };
}
