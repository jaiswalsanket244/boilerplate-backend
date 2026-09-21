import { Request, Response } from "express";
import httpStatus from "http-status";

export class HealthController {
  public getHealth = (_req: Request, res: Response) => {
    return res.status(httpStatus.OK).json({
      status: "ok",
      uptime: process.uptime(),
    });
  };
}
