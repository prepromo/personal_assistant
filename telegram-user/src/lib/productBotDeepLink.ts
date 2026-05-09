import type { ReplyMode } from "./policy.js";

const MODE_TO_CHAR: Record<ReplyMode, string> = {
  manual: "m",
  suggest: "s",
  auto: "a",
};

const CHAR_TO_MODE: Record<string, ReplyMode> = {
  m: "manual",
  s: "suggest",
  a: "auto",
};

/** UUID без дефисов, 32 hex. */
export function uuidToHex32(uuid: string): string | null {
  const s = uuid.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(s) ? s : null;
}

export function hex32ToUuid(hex: string): string | null {
  const s = hex.toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return null;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Deep link start payload (Telegram: до 64 символов, [A-Za-z0-9_-]).
 * Формат: `d` + 32 hex (dialog id) + `m|s|a` = 34 символа.
 */
export function encodeDialogModePayload(dialogId: string, mode: ReplyMode): string | null {
  const hex = uuidToHex32(dialogId);
  if (!hex) return null;
  const ch = MODE_TO_CHAR[mode];
  if (!ch) return null;
  return `d${hex}${ch}`;
}

export function decodeDialogModePayload(payload: string): { dialogId: string; mode: ReplyMode } | null {
  const p = payload.trim();
  if (p.length !== 34 || p[0] !== "d") return null;
  const hex = p.slice(1, 33);
  const modeChar = p.slice(33);
  const dialogId = hex32ToUuid(hex);
  const mode = CHAR_TO_MODE[modeChar];
  if (!dialogId || !mode) return null;
  return { dialogId, mode };
}

export function productBotDeepLinkUrl(botUsername: string, payload: string): string {
  const u = botUsername.replace(/^@/, "").trim();
  const safe = /^[A-Za-z0-9_-]+$/.test(payload) ? payload : encodeURIComponent(payload);
  return `https://t.me/${u}?start=${safe}`;
}
