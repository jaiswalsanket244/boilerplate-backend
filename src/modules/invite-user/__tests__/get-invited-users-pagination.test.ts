import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createAdminSession } from "@/tests/utils/auth";

describe("GET /api/admin/invite-users — pagination validation", () => {
  const app = createApp();

  it("returns 400 for a negative page", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/invite-users?page=-1")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when pageSize exceeds the max of 100", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/invite-users?pageSize=101")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 200 for a valid page/pageSize request", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/invite-users?page=1&pageSize=5")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
