import { Router } from "express";

import { MaintenanceController } from "@/modules/maintenance/maintenance.controller";

/**
 * Public maintenance-status router — intentionally omits authMiddleware so the
 * frontend banner can read the flag without a session.
 */
export class MaintenanceRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new MaintenanceController();

    this.router.get("/", controller.getStatus);
  }
}
