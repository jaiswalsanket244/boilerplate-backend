import { type Request, type Response } from "express";
import status from "http-status";

import { SuccessResponse } from "@/helpers/api-response";
import envConfig from "@/config/env";
import { MAINTENANCE_MESSAGES } from "@/modules/maintenance/utils/maintenance.constant";

/**
 * MaintenanceController exposes the config-driven maintenance flag/message so
 * the public banner endpoint can report degraded-service state.
 */
export class MaintenanceController {
  getStatus = (_req: Request, res: Response) => {
    return SuccessResponse(res, status.OK, {
      message: MAINTENANCE_MESSAGES.STATUS,
      data: {
        maintenanceMode: envConfig.MAINTENANCE_MODE,
        maintenanceMessage: envConfig.MAINTENANCE_MESSAGE,
      },
    });
  };
}
