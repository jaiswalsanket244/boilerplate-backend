import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import {
  listUserSessions,
  revokeOtherSessions,
  revokeUserSession,
} from "@/modules/auth/helpers/session.helper";
import type { TAuthController } from "@/modules/auth/utils/auth.types";
import { NextFunction, Request, Response } from "express";
import status from "http-status";

export class SessionsController {
  public list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Forbidden Access",
        });
      }

      const sessions = await listUserSessions(req.user._id, req.user.sessionId);

      return SuccessResponse(res, status.OK, {
        message: "Sessions retrieved successfully.",
        data: { sessions },
      });
    } catch (error) {
      next(error);
    }
  };

  public revokeOne: TAuthController["revokeSession"] = async (
    req,
    res,
    next,
  ) => {
    try {
      if (!req.user) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Forbidden Access",
        });
      }

      const { sessionId } = req.params;
      const outcome = await revokeUserSession(
        req.user._id,
        sessionId,
        req.user.sessionId,
      );

      if (outcome === "current") {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Cannot revoke the current session. Use logout instead.",
        });
      }

      if (outcome === "not_found") {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "Session not found.",
        });
      }

      return SuccessResponse(res, status.OK, {
        message: "Session revoked successfully.",
        data: { success: true },
      });
    } catch (error) {
      next(error);
    }
  };

  public revokeOthers = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user?.sessionId) {
        return ErrorResponse(res, status.UNAUTHORIZED, {
          message: "Forbidden Access",
        });
      }

      const revokedCount = await revokeOtherSessions(
        req.user._id,
        req.user.sessionId,
      );

      return SuccessResponse(res, status.OK, {
        message: "Other sessions revoked successfully.",
        data: { revokedCount },
      });
    } catch (error) {
      next(error);
    }
  };
}
