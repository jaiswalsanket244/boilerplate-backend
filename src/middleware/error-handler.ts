import { ErrorLogs } from "@/db/models/errorLogs";
import { ErrorResponse } from "@/helpers/api-response";
import { ERROR_TYPE } from "@/enums";
import { NextFunction, Response, Request } from "express";
import status from "http-status";

const SENSITIVE_FIELDS = ["password", "token", "authorization"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Deep-copy `data`, replacing any sensitive field value with "[REDACTED]" at any
// nesting depth, including inside arrays. Special objects (Date, ObjectId,
// Buffer, …) aren't plain objects, so they're treated as leaves and passed
// through untouched.
function sanitizeData(data: any): any {
  if (Array.isArray(data)) return data.map(sanitizeData);
  if (isPlainObject(data)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = SENSITIVE_FIELDS.includes(key)
        ? "[REDACTED]"
        : sanitizeData(value);
    }
    return sanitized;
  }
  return data;
}

// Async function to log error
export async function logError(err: any, errorType: ERROR_TYPE, req?: Request) {
  try {
    const stackTrace = err.stack?.split("\n").slice(0, 100).join("\n");
    const statusCode = status.INTERNAL_SERVER_ERROR;

    // Create error document
    const errorLog = new ErrorLogs({
      // Basic Error Information
      name: err.name,
      message: err.message,
      stackTrace,
      type: errorType,

      // Request Context
      ...(req && {
        request: {
          method: req.method,
          statusCode,
          url: req.originalUrl,
          path: req.route?.path,
          headers: sanitizeData(req.headers),
          query: sanitizeData(req.query),
          params: sanitizeData(req.params),
          body: sanitizeData(req.body),
        },
      }),

      // User Context
      ...(req?.user && {
        context: {
          userRef: req.user._id,
          userAgent: req.get("user-agent"),
          ip: req.ip,
        },
      }),
    });

    errorLog.save().catch((saveErr) => {
      console.error("Error saving error log:", saveErr);
    });
  } catch (loggingError) {
    console.error("Error in error logging:", loggingError);
  }
}

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Start error logging asynchronously
  logError(err, ERROR_TYPE.GENERIC, req);

  return ErrorResponse(res, status.INTERNAL_SERVER_ERROR, {
    message: err.message,
  });
}
