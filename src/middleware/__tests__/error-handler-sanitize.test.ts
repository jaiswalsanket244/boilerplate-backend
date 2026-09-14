import { describe, expect, it, vi } from "vitest";

import { ERROR_TYPE } from "@/enums";
import { logError } from "@/middleware/error-handler";

const saveMock = vi.fn().mockResolvedValue(undefined);
let captured: Record<string, any> = {};

vi.mock("@/db/models/errorLogs", () => ({
  ErrorLogs: class {
    constructor(doc: Record<string, any>) {
      captured = doc;
    }
    save = saveMock;
  },
}));

function makeReq(body: unknown) {
  return {
    method: "POST",
    originalUrl: "/x",
    headers: {},
    query: {},
    params: {},
    body,
    get: () => undefined,
  } as any;
}

describe("error-log sanitizeData nested redaction", () => {
  it("redacts a top-level sensitive field (existing behavior)", async () => {
    await logError(
      new Error("boom"),
      ERROR_TYPE.GENERIC,
      makeReq({ password: "hunter2" }),
    );
    expect(captured.request.body).toEqual({ password: "[REDACTED]" });
  });

  it("redacts a sensitive field nested inside an object", async () => {
    await logError(
      new Error("boom"),
      ERROR_TYPE.GENERIC,
      makeReq({ user: { password: "hunter2" } }),
    );
    expect(JSON.stringify(captured.request.body)).not.toContain("hunter2");
    expect(captured.request.body).toEqual({ user: { password: "[REDACTED]" } });
  });

  it("redacts sensitive fields nested inside arrays", async () => {
    await logError(
      new Error("boom"),
      ERROR_TYPE.GENERIC,
      makeReq({ users: [{ name: "a", token: "leak-me" }] }),
    );
    expect(JSON.stringify(captured.request.body)).not.toContain("leak-me");
    expect(captured.request.body).toEqual({
      users: [{ name: "a", token: "[REDACTED]" }],
    });
  });

  it("leaves non-sensitive values untouched", async () => {
    await logError(
      new Error("boom"),
      ERROR_TYPE.GENERIC,
      makeReq({ user: { name: "alice", age: 30 } }),
    );
    expect(captured.request.body).toEqual({ user: { name: "alice", age: 30 } });
  });
});
