/**
 * OpenAI-compatible chat completions. Порядок:
 * 1) OPENCLAW_GATEWAY_URL + OPENCLAW_GATEWAY_TOKEN — только если model = `openclaw` или `openclaw/<agentId>` (иначе gateway отвечает 400).
 * 2) CABINET_OPENAI_BASE_URL + CABINET_OPENAI_API_KEY (или OPENAI_BASE_URL + OPENAI_API_KEY) — напрямую gpt2giga :8090, модель `GigaChat`.
 *
 * При 429 (GigaChat rate limit) — повтор с экспоненциальной задержкой (env LLM_MAX_ATTEMPTS, LLM_RETRY_BASE_MS).
 */
export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** Опции запроса к /v1/chat/completions (кабинет может не передавать). */
export type ChatCompletionOptions = {
  maxTokens?: number;
  temperature?: number;
};

export async function runChatCompletion(
  messages: ChatMsg[],
  opts?: ChatCompletionOptions,
): Promise<{ content: string; provider: string }> {
  const gateway = process.env.OPENCLAW_GATEWAY_URL?.replace(/\/$/, "");
  const gwToken = process.env.OPENCLAW_GATEWAY_TOKEN;
  const gwModel =
    process.env.OPENCLAW_CHAT_MODEL || "custom-gigachat-devices-sberbank-ru/GigaChat";

  if (gateway && gwToken) {
    const text = await postOpenAiCompatibleWithRetry(
      `${gateway}/v1/chat/completions`,
      gwToken,
      gwModel,
      messages,
      opts,
    );
    return { content: text, provider: "openclaw-gateway" };
  }

  const base =
    process.env.CABINET_OPENAI_BASE_URL?.replace(/\/$/, "") ||
    process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ||
    "";
  const key = process.env.CABINET_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.CABINET_OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

  if (base && key) {
    const text = await postOpenAiCompatibleWithRetry(`${base}/v1/chat/completions`, key, model, messages, opts);
    return { content: text, provider: "openai-compatible" };
  }

  throw new Error(
    "LLM не настроен: задайте OPENCLAW_GATEWAY_URL + OPENCLAW_GATEWAY_TOKEN или CABINET_OPENAI_BASE_URL + CABINET_OPENAI_API_KEY (или OPENAI_BASE_URL + OPENAI_API_KEY)",
  );
}

function isRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("429") || m.includes("too many requests") || m.includes("rate limit");
}

async function postOpenAiCompatibleWithRetry(
  url: string,
  bearer: string,
  model: string,
  messages: ChatMsg[],
  opts?: ChatCompletionOptions,
): Promise<string> {
  const maxAttempts = Math.min(8, Math.max(1, Number(process.env.LLM_MAX_ATTEMPTS) || 4));
  const baseMs = Math.max(400, Number(process.env.LLM_RETRY_BASE_MS) || 2000);
  let lastErr: Error = new Error("LLM: unknown");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await postOpenAiCompatibleOnce(url, bearer, model, messages, opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = e instanceof Error ? e : new Error(msg);
      if (!isRateLimitError(msg) || attempt === maxAttempts) {
        throw lastErr;
      }
      const waitMs = baseMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function formatFetchFailure(url: string, err: unknown): string {
  const base = url.replace(/\/v1\/chat\/completions\/?$/, "") || url;
  const bits: string[] = [];
  if (err instanceof Error) {
    bits.push(err.message);
    const c = err.cause;
    if (c instanceof Error) bits.push(`cause: ${c.message}`);
    else if (c !== undefined && c !== null) bits.push(`cause: ${String(c)}`);
  } else {
    bits.push(String(err));
  }
  let hint = "";
  if (/127\.0\.0\.1:18789|:18789/.test(url)) {
    hint =
      " | Подсказка: не запущен OpenClaw gateway на :18789 — выполните openclaw gateway run или openclaw/scripts/start-gateway.ps1; либо закомментируйте OPENCLAW_* в telegram-user/.env и укажите OPENAI_BASE_URL=http://127.0.0.1:8090/v1 + ключ от gpt2giga (см. openclaw/README.md).";
  } else if (/127\.0\.0\.1:8090|:8090/.test(url)) {
    hint =
      " | Подсказка: проверьте прокси gpt2giga (порт 8090), скрипт install-gpt2giga / refresh токена.";
  }
  return `LLM fetch: ${bits.join(" ")} (endpoint ${base})${hint}`;
}

async function postOpenAiCompatibleOnce(
  url: string,
  bearer: string,
  model: string,
  messages: ChatMsg[],
  opts?: ChatCompletionOptions,
): Promise<string> {
  const temperature = opts?.temperature ?? 0.5;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
  };
  if (opts?.maxTokens != null && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(formatFetchFailure(url, e));
  }
  const raw = await r.text();
  if (!r.ok) {
    throw new Error(`LLM HTTP ${r.status}: ${raw.slice(0, 500)}`);
  }
  let j: { choices?: { message?: { content?: string } }[] };
  try {
    j = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
  } catch {
    throw new Error("LLM: невалидный JSON");
  }
  const c = j.choices?.[0]?.message?.content;
  if (typeof c !== "string" || !c.trim()) {
    throw new Error("LLM: пустой ответ");
  }
  return c.trim();
}
