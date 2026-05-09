/**
 * OpenClaw Gateway — см. https://docs.openclaw.ai/gateway/openai-http-api
 * Нужны: включённый POST /v1/chat/completions и OPENCLAW_GATEWAY_TOKEN.
 */
import { logger } from "../lib/logger.js";

function gatewayBase() {
  return (process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789").replace(/\/$/, "");
}

/** Сообщение для Telegram/логов: Node fetch часто даёт только «fetch failed», детали в err.cause */
function formatGatewayNetworkError(err, baseUrl) {
  const c = err?.cause;
  const code = c?.code || err?.code;
  const syscall = c?.syscall;
  const addr = c?.address && c?.port != null ? `${c.address}:${c.port}` : null;
  const detail = [code, syscall, addr, c?.message].filter(Boolean).join(" ");
  const hint =
    code === "ECONNREFUSED"
      ? " Запустите OpenClaw gateway (например openclaw\\scripts\\start-gateway.ps1) и проверьте OPENCLAW_GATEWAY_URL."
      : code === "ENOTFOUND"
        ? " Проверьте hostname в OPENCLAW_GATEWAY_URL."
        : "";
  return `сеть: ${detail || err?.message || "fetch failed"} (${baseUrl})${hint}`;
}

export async function probeGateway() {
  const base = gatewayBase();
  try {
    const res = await fetch(`${base}/`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    logger.warn("openclaw probe failed", { message: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Запрос ответа агента через OpenAI-совместимый chat/completions.
 * @param {{ userText: string, sessionKey: string }} p — sessionKey стабилен для контекста диалога (Telegram chat).
 * @returns {Promise<string>}
 */
export async function openClawChatCompletion({ userText, sessionKey }) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) {
    throw new Error("Задайте OPENCLAW_GATEWAY_TOKEN в backend/.env (токен gateway из OpenClaw)");
  }

  const base = gatewayBase();
  // OpenClaw HTTP API: поле model — цель агента (openclaw/default), не id провайдера (GigaChat).
  // Бэкенд GigaChat задаётся в ~/.openclaw/openclaw.json у агента.
  const model = process.env.OPENCLAW_CHAT_MODEL || "openclaw/default";

  let res;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: userText }],
        user: sessionKey,
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    logger.warn("openclaw fetch failed", { base, message: e?.message, cause: e?.cause?.message, code: e?.cause?.code });
    throw new Error(formatGatewayNetworkError(e, base));
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      `OpenClaw HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (content == null || String(content).trim() === "") {
    throw new Error("OpenClaw вернул пустой ответ");
  }
  return String(content).trim();
}

export function isOpenClawConfigured() {
  return !!process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
}
