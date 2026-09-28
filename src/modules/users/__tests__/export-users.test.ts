import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import "@/tests/mocks/database.mock";

import { createApp } from "@/app";
import { AuditLogModel } from "@/db/models/audit-logs/audit-log";
import { User } from "@/db/models/user";
import { STATUS, USER_TYPE } from "@/enums";
import { createAdminSession, createTestSession } from "@/tests/utils/auth";

async function waitForRow(filter: object, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await AuditLogModel.findOne(filter).lean();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

function createUser(
  companyRef: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return User.create({
    email: `${new mongoose.Types.ObjectId().toString()}@a.test`,
    name: { first: "Jane", last: "Doe" },
    externalUserId: new mongoose.Types.ObjectId().toString(),
    roles: USER_TYPE.USER,
    status: STATUS.ACTIVE,
    companyRef,
    ...overrides,
  });
}

describe("GET /api/admin/user/export", () => {
  const app = createApp();

  beforeEach(async () => {
    await AuditLogModel.deleteMany({});
  });

  it("returns the caller's company users as a CSV attachment", async () => {
    const session = await createAdminSession();
    const member = await createUser(session.company._id, {
      email: "member@a.test",
      name: { first: "Smith, Jr.", last: "=HYPERLINK(1)" },
      phone: "+15550001111",
    });

    const res = await request(app)
      .get("/api/admin/user/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="users-\d{4}-\d{2}-\d{2}\.csv"$/,
    );

    const lines = res.text.split("\r\n");
    expect(lines[0]).toBe(
      "id,firstName,lastName,email,phone,role,status,forcePasswordChange,lastActivity,createdAt,updatedAt",
    );
    // Admin + member, ordered by createdAt.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(session.user.email);

    const memberLine = lines[2];
    expect(memberLine.startsWith(`${member._id.toString()},`)).toBe(true);
    expect(memberLine).toContain('"Smith, Jr."');
    expect(memberLine).toContain("'=HYPERLINK(1)");
    expect(memberLine).toContain("'+15550001111");
    expect(memberLine).toContain(`member@a.test,`);
  });

  it("excludes users from other companies and never leaks secret fields", async () => {
    const session = await createAdminSession();
    const other = await createTestSession(USER_TYPE.ADMIN);
    await createUser(other.company._id, { email: "outsider@b.test" });
    await User.updateOne(
      { _id: session.user._id },
      { twoFaSecret: "SUPERSECRET", cardTokens: ["tok_secret"] },
    );

    const res = await request(app)
      .get("/api/admin/user/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("outsider@b.test");
    expect(res.text).not.toContain(other.user.email);
    expect(res.text).not.toContain("SUPERSECRET");
    expect(res.text).not.toContain("tok_secret");
  });

  it("emits an admin.export_run audit row", async () => {
    const session = await createAdminSession();

    const res = await request(app)
      .get("/api/admin/user/export")
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);

    const row = await waitForRow({ action: "admin.export_run" });
    expect(row).toBeTruthy();
    expect(row?.status).toBe("success");
    expect(row?.actorId.toString()).toBe(session.user._id.toString());
    expect(row?.metadata).toMatchObject({
      resource: "users",
      format: "csv",
      rowCount: 1,
    });
  });

  it("rejects callers without users:view", async () => {
    const session = await createTestSession(USER_TYPE.USER);

    const res = await request(app)
      .get("/api/admin/user/export")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(403);
  });
});
