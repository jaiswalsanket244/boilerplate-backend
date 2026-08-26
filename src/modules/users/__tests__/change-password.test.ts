import { createApp } from "@/app";
import { USER_TYPE } from "@/enums";
import { User } from "@/db/models/user";
import { mockAuthKitProvider } from "@/tests/mocks/authkit-provider.mock";
import { createTestSession } from "@/tests/utils/auth";
import { faker } from "@faker-js/faker";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Socket.IO is never initialized in the test process; the notification emit it
// fires on password change would otherwise throw and surface as a 500.
vi.mock("@/providers/socket", () => ({
  socketService: { emitToUser: vi.fn() },
}));

/**
 * POST /api/user/change-password              — user changes own password
 * POST /api/super-admin/user/change-password/:id — super-admin changes a user's password
 *
 * Both enforce the canonical password policy on newPassword:
 * min 8 chars + at least one letter + one digit + one special character.
 */

function buildChangePasswordPayload(overrides: Record<string, unknown> = {}) {
  return {
    currentPassword: "OldPass@123",
    newPassword: "Passw0rd!",
    confirmedPassword: "Passw0rd!",
    ...overrides,
  };
}

describe("POST /api/user/change-password", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
      user: { id: faker.string.uuid(), email: faker.internet.email() },
    });
    mockAuthKitProvider.updateUser.mockResolvedValue({
      id: faker.string.uuid(),
    });
  });

  describe("validation errors", () => {
    it("returns 400 when newPassword is shorter than 8 characters", async () => {
      const { cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/user/change-password")
        .set("Cookie", cookie)
        .send(
          buildChangePasswordPayload({
            newPassword: "Ab1!",
            confirmedPassword: "Ab1!",
          }),
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when newPassword has no digit", async () => {
      const { cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/user/change-password")
        .set("Cookie", cookie)
        .send(
          buildChangePasswordPayload({
            newPassword: "Password!",
            confirmedPassword: "Password!",
          }),
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when newPassword has no special character", async () => {
      const { cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/user/change-password")
        .set("Cookie", cookie)
        .send(
          buildChangePasswordPayload({
            newPassword: "Password1",
            confirmedPassword: "Password1",
          }),
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("success", () => {
    it("accepts a valid strong password", async () => {
      const { cookie } = await createTestSession();

      const res = await request(app)
        .post("/api/user/change-password")
        .set("Cookie", cookie)
        .send(buildChangePasswordPayload())
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

describe("POST /api/super-admin/user/change-password/:id", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthKitProvider.authenticateWithPassword.mockResolvedValue({
      user: { id: faker.string.uuid(), email: faker.internet.email() },
    });
    mockAuthKitProvider.updateUser.mockResolvedValue({
      id: faker.string.uuid(),
    });
  });

  describe("validation errors", () => {
    it("returns 400 when newPassword is shorter than 8 characters", async () => {
      const { cookie } = await createTestSession(USER_TYPE.SUPER_ADMIN);
      const { user: target } = await createTestSession();

      const res = await request(app)
        .post(`/api/super-admin/user/change-password/${target._id}`)
        .set("Cookie", cookie)
        .send(
          buildChangePasswordPayload({
            newPassword: "Ab1!",
            confirmedPassword: "Ab1!",
          }),
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when newPassword has no digit", async () => {
      const { cookie } = await createTestSession(USER_TYPE.SUPER_ADMIN);
      const { user: target } = await createTestSession();

      const res = await request(app)
        .post(`/api/super-admin/user/change-password/${target._id}`)
        .set("Cookie", cookie)
        .send(
          buildChangePasswordPayload({
            newPassword: "Password!",
            confirmedPassword: "Password!",
          }),
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when newPassword has no special character", async () => {
      const { cookie } = await createTestSession(USER_TYPE.SUPER_ADMIN);
      const { user: target } = await createTestSession();

      const res = await request(app)
        .post(`/api/super-admin/user/change-password/${target._id}`)
        .set("Cookie", cookie)
        .send(
          buildChangePasswordPayload({
            newPassword: "Password1",
            confirmedPassword: "Password1",
          }),
        )
        .set("Accept", "application/json");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("success", () => {
    it("accepts a valid strong password", async () => {
      const { cookie } = await createTestSession(USER_TYPE.SUPER_ADMIN);
      const { user: target } = await createTestSession();

      const res = await request(app)
        .post(`/api/super-admin/user/change-password/${target._id}`)
        .set("Cookie", cookie)
        .send(buildChangePasswordPayload())
        .set("Accept", "application/json");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await User.findById(target._id);
      expect(updated?.hasPassword).toBe(true);
    });
  });
});
