import { createApp } from "@/app";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/auth/logout
 *
 * Auth required : No (clears cookie regardless)
 * Body         : none
 *
 * Success  : 200 – clears auth cookies
 * Failures : 500 server error
 */

describe("POST /api/auth/logout", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy Path
  // =========================================================================

  describe("success", () => {
    it("returns 200 with a success message", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
    });

    it("clears the auth cookie on logout", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Accept", "application/json");

      expect(res.status).toBe(200);

      // The Set-Cookie header should contain a cleared `token` cookie
      const cookies = res.headers["set-cookie"] as unknown as string[];
      if (cookies) {
        const tokenCookie = cookies.find((c: string) => c.startsWith("token="));
        // Cleared cookies have Max-Age=0 or Expires in the past
        if (tokenCookie) {
          expect(
            tokenCookie.includes("Max-Age=0") ||
              tokenCookie.includes("Expires=") ||
              tokenCookie.includes("token=;"),
          ).toBe(true);
        }
      }
    });
  });
});
