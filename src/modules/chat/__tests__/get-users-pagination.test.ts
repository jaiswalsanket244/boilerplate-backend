import { createApp } from "@/app";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createAdminSession } from "@/tests/utils/auth";

// Chat exposes the page size under the aliased param `limit` (not pageSize),
// so these prove the shared bounds apply to that external name too.
describe("GET /api/chat/users — pagination validation", () => {
  const app = createApp();

  it("returns 400 for a negative page", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/chat/users?page=-1")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when limit exceeds the max of 100", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/chat/users?limit=101")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 200 for a valid page/limit request", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/chat/users?page=1&limit=5")
      .set("Cookie", session.cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
