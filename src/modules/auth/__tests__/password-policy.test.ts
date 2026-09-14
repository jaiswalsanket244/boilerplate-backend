import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_ERROR_MESSAGES,
  passwordPolicySchema,
} from "@/modules/auth/utils/password.constant";
import { describe, expect, it } from "vitest";

// Unit tests for the single source of truth every password-setting flow imports.
// Each rejection case isolates ONE rule: the fixture satisfies every other rule
// so the failing message is unambiguous, and we assert issues[0] to pin the exact
// rule that fired (Zod reports failures in schema-declaration order).
describe("passwordPolicySchema", () => {
  it("accepts a password that satisfies every rule", () => {
    const result = passwordPolicySchema.safeParse("StrongPass@123");
    expect(result.success).toBe(true);
  });

  it("rejects a password shorter than the minimum length", () => {
    // "Aa@1" has upper/lower/number/special but is too short — only the length rule fails.
    const result = passwordPolicySchema.safeParse("Aa@1");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      PASSWORD_POLICY_ERROR_MESSAGES.minLength,
    );
  });

  it("rejects a password missing a number", () => {
    const result = passwordPolicySchema.safeParse("StrongPass@abc");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      PASSWORD_POLICY_ERROR_MESSAGES.number,
    );
  });

  it("rejects a password missing a special character", () => {
    const result = passwordPolicySchema.safeParse("StrongPass123");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      PASSWORD_POLICY_ERROR_MESSAGES.special,
    );
  });

  it("rejects a password missing an uppercase letter", () => {
    const result = passwordPolicySchema.safeParse("strongpass@123");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      PASSWORD_POLICY_ERROR_MESSAGES.upperAndLower,
    );
  });

  it("rejects a password missing a lowercase letter", () => {
    const result = passwordPolicySchema.safeParse("STRONGPASS@123");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      PASSWORD_POLICY_ERROR_MESSAGES.upperAndLower,
    );
  });

  it("accepts a password at exactly the minimum length", () => {
    // Boundary check: "Aa@1" supplies the four required character classes and we pad
    // with lowercase 'b's to hit PASSWORD_MIN_LENGTH exactly, proving the length rule
    // is inclusive (>=) rather than exclusive (>). Derived from the constant so the
    // test stays correct if the minimum ever changes.
    const password = `Aa@1${"b".repeat(PASSWORD_MIN_LENGTH - 4)}`;
    expect(password.length).toBe(PASSWORD_MIN_LENGTH);
    expect(passwordPolicySchema.safeParse(password).success).toBe(true);
  });
});
