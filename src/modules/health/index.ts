import { Router } from "express";
import { HealthController } from "@/modules/health/health.controller";

export class HealthRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  initializeRoutes() {
    const controller = new HealthController();

    this.router.get("/", controller.getHealth);
  }
}
