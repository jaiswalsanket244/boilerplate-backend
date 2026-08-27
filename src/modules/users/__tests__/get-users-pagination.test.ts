import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createAdminSession } from "@/tests/utils/auth";

describe("GET /api/admin/user — pagination validation", () => {
  const app = createApp();

  it("returns 400 for a negative page", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/user?page=-1")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when pageSize exceeds the max of 100", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/user?pageSize=101")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 200 with correct pagination metadata for a valid request", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/user?page=1&pageSize=5")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].page).toBe(1);
    expect(res.body.data[0].pageSize).toBe(5);
  });
});
