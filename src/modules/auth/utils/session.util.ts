import { IRefreshTokenDocument } from "@/db/models/refreshToken";
import { ISessionDTO } from "@/modules/auth/utils/session.types";

const UNKNOWN = "Unknown";

/**
 * Minimal in-repo user-agent parser. Chosen over adding `ua-parser-js` to keep
 * the dependency/bundle footprint at zero — the product only needs a coarse
 * browser/OS/device label, not the full UA taxonomy. Order is significant:
 * tokens overlap (Edge/Opera embed "Chrome"; Chrome embeds "Safari"), so the
 * more specific match must be tested first.
 */
export function parseUserAgent(userAgent?: string): {
  browser: string;
  os: string;
  device: string;
} {
  const ua = userAgent?.trim();
  if (!ua || ua.toLowerCase() === UNKNOWN.toLowerCase()) {
    return { browser: UNKNOWN, os: UNKNOWN, device: UNKNOWN };
  }

  return {
    browser: detectBrowser(ua),
    os: detectOs(ua),
    device: detectDevice(ua),
  };
}

function detectBrowser(ua: string): string {
  if (/Edg(e|A|iOS)?\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS/i.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return UNKNOWN;
}

function detectOs(ua: string): string {
  if (/Windows/i.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod|iOS/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return UNKNOWN;
}

function detectDevice(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  // Android without "Mobile" is conventionally a tablet.
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "Mobile";
  return "Desktop";
}

/**
 * Map a stored refresh-token row to the session DTO. Deliberately omits the
 * token value and every internal field so raw secrets never reach the client.
 */
export function toSessionDTO(
  row: Pick<
    IRefreshTokenDocument,
    "sessionId" | "userAgent" | "ip" | "lastActiveAt" | "createdAt"
  >,
  currentSessionId?: string,
): ISessionDTO {
  const { browser, os, device } = parseUserAgent(row.userAgent);

  return {
    id: row.sessionId ?? "",
    device,
    browser,
    os,
    ipDisplay: row.ip ?? UNKNOWN,
    lastActiveAt: row.lastActiveAt ?? null,
    createdAt: row.createdAt,
    isCurrent: !!row.sessionId && row.sessionId === currentSessionId,
  };
}
