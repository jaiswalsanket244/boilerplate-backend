import { Router } from "express";
import status from "http-status";

import { ErrorResponse } from "@/helpers/api-response";
import { isDevEnvironment } from "@/helpers/common";
import { E2eSupportController } from "@/modules/e2e-support/e2e-support.controller";

/**
 * Support endpoints for the local E2E suite: reading captured emails and
 * tearing down test accounts. Mounted only in development.
 */
export class E2eSupportRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new E2eSupportController();

    this.router.use((_req, res, next) => {
      if (!isDevEnvironment()) {
        return ErrorResponse(res, status.NOT_FOUND, {
          message: "Route Not Found",
        });
      }
      next();
    });

    this.router.get("/emails", controller.getEmails);
    this.router.delete("/emails", controller.clearEmails);
    this.router.delete("/users/:email", controller.deleteTestUser);
  }
}
