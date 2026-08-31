import { createApp } from "@/app";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import envConfig from "@/config/env";
import { MAINTENANCE_MESSAGES } from "@/modules/maintenance/utils/maintenance.constant";

/**
 * GET /api/maintenance
 *
 * Auth required : No (public — the frontend banner reads it without a session)
 * Success       : 200 – { maintenanceMode: boolean, maintenanceMessage: string }
 *
 * The flag/message come from the validated envConfig, which is parsed once at
 * startup. To exercise the "on" state we mutate envConfig for a single test and
 * restore the originals afterwards.
 */
describe("GET /api/maintenance", () => {
  const app = createApp();

  const originalMode = envConfig.MAINTENANCE_MODE;
  const originalMessage = envConfig.MAINTENANCE_MESSAGE;

  afterEach(() => {
    envConfig.MAINTENANCE_MODE = originalMode;
    envConfig.MAINTENANCE_MESSAGE = originalMessage;
  });

  it("is reachable without auth and reports maintenanceMode=false by default", async () => {
    const res = await request(app)
      .get("/api/maintenance")
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(MAINTENANCE_MESSAGES.STATUS);
    expect(res.body.data).toEqual({
      maintenanceMode: false,
      maintenanceMessage: "",
    });
    expect(res.body.errors).toEqual({});
  });

  it("reports maintenanceMode=true with the configured message when enabled", async () => {
    envConfig.MAINTENANCE_MODE = true;
    envConfig.MAINTENANCE_MESSAGE = "We are down for scheduled upgrades.";

    const res = await request(app)
      .get("/api/maintenance")
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      maintenanceMode: true,
      maintenanceMessage: "We are down for scheduled upgrades.",
    });
  });
});
