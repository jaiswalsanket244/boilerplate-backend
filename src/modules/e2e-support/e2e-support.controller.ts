import { Request, Response } from "express";
import status from "http-status";

import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { deleteTestUserCompletely } from "@/modules/e2e-support/helpers/delete-test-user.helper";
import {
  isTestAccountEmail,
  listCapturedEmails,
  normalizeEmail,
} from "@/modules/e2e-support/helpers/e2e-support.helper";
import { TEST_USER_EMAIL_SUFFIX } from "@/modules/e2e-support/utils/e2e-support.constant";
import { clearCapturedEmails } from "@/providers/email/local-email.store";

export class E2eSupportController {
  public getEmails = (req: Request, res: Response) => {
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const limit = Number.parseInt(String(req.query.limit), 10);

    return SuccessResponse(res, status.OK, {
      message: "Captured emails fetched successfully",
      data: { emails: listCapturedEmails(to, limit) },
    });
  };

  public clearEmails = (_req: Request, res: Response) => {
    clearCapturedEmails();

    return SuccessResponse(res, status.OK, {
      message: "Captured emails cleared successfully",
    });
  };

  public deleteTestUser = async (req: Request, res: Response) => {
    const email = normalizeEmail(req.params.email);

    if (!isTestAccountEmail(email)) {
      return ErrorResponse(res, status.FORBIDDEN, {
        message: `Only ${TEST_USER_EMAIL_SUFFIX} accounts can be deleted through the E2E API`,
      });
    }

    try {
      const result = await deleteTestUserCompletely({ email });

      return SuccessResponse(res, status.OK, {
        message: result.deleted
          ? "Test user deleted successfully"
          : "Test user not found (nothing to delete)",
        data: result,
      });
    } catch (error) {
      return ErrorResponse(res, status.INTERNAL_SERVER_ERROR, {
        message: `Failed to delete test user: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  };
}
