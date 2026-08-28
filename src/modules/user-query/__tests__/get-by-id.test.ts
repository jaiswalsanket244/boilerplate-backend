import { createApp } from "@/app";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestSession } from "@/tests/utils/auth";
import { USER_TYPE } from "@/enums";
import { USER_QUERY_MESSAGES } from "@/modules/user-query/utils/user-query.constant";

// ---------------------------------------------------------------------------
// GET /api/help/:id (UserQueryController.getById)
//
// Auth required : Yes (USER_QUERY_VIEW)
//
// Success  : 200 – query data with success: true
// Failures : 404 not found (error-shaped, success: false)
// ---------------------------------------------------------------------------

describe("GET /api/help/:id", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error-shaped 404 when the query does not exist", async () => {
    const { cookie } = await createTestSession(USER_TYPE.ADMIN);
    const missingId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/help/${missingId}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(USER_QUERY_MESSAGES.NOT_FOUND);
  });
});
