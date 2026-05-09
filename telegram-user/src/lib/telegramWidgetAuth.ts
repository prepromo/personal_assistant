import crypto from "node:crypto";

/**
 * Проверка подписи редиректа Telegram Login Widget.
 * @see https://core.telegram.org/widgets/login
 */
export function verifyTelegramLoginWidget(params: Record<string, string>, botToken: string): boolean {
  const hash = params.hash;
  if (!hash || !botToken) return false;
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return false;

  const pairs = Object.entries(params).filter(([k]) => k !== "hash");
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return timingSafeEqualHex(hmac, hash);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Express query → плоская map строк (для GET callback). */
export function flattenQueryStringRecord(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}
