import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "@/app";

/**
 * GET /health – service health check
 *
 * Auth required : No
 * Output        : 200 { status: "ok", uptime: <number> }
 */

describe("GET /health", () => {
  const app = createApp();

  it("returns 200 with status ok and a numeric uptime", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("does not require authentication", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
  });
});
