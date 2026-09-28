import jwt, { type JwtPayload } from "jsonwebtoken";
import { InvitedUsers } from "@/db/models/invitedUsers";
import { JWT_CONFIG, JwtHelper } from "@/helpers/jwt";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

describe("invitation expiry", () => {
  it("signs invite tokens that expire 14 days after issue", () => {
    const token = new JwtHelper().generateToken(
      { email: "invitee@example.com" },
      JWT_CONFIG.INVITE_TOKEN_EXPIRY,
    );
    const { iat, exp } = jwt.decode(token) as JwtPayload;

    expect(exp! - iat!).toBe(14 * SECONDS_PER_DAY);
  });

  it("leaves refresh tokens at 7 days", () => {
    const token = new JwtHelper().generateToken(
      { email: "user@example.com" },
      JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
    );
    const { iat, exp } = jwt.decode(token) as JwtPayload;

    expect(exp! - iat!).toBe(7 * SECONDS_PER_DAY);
  });

  it("defaults the stored invite expiry to 14 days", () => {
    const invite = new InvitedUsers({ invitedEmail: "invitee@example.com" });
    const remaining = invite.expiry - Date.now();

    expect(remaining).toBeGreaterThan(13 * MS_PER_DAY);
    expect(remaining).toBeLessThanOrEqual(14 * MS_PER_DAY);
  });

  it("keeps an explicit expiry on an existing invite", () => {
    const sevenDayExpiry = Date.now() + 7 * MS_PER_DAY;
    const invite = new InvitedUsers({
      invitedEmail: "invitee@example.com",
      expiry: sevenDayExpiry,
    });

    expect(invite.expiry).toBe(sevenDayExpiry);
  });
});
