import { runChatCompletion, type ChatMsg } from "./llm/chatCompletion.js";

const OUTBOUND_SYSTEM = [
  "Ты редактор переписки: из инструкций пользователя и (если есть) черновика первого сообщения составляешь **одно** короткое сообщение в Telegram **от пользователя к контакту**.",
  "Запрещено: копировать мета-фразы («напиши пользователю…», «попроси бота…»), длинные цитаты задания, списки шагов для ассистента.",
  "Нужно: естественный язык (чаще русский), 1–6 коротких предложений по сути задачи. Без «Я — бот», без markdown.",
  "Вывод: только текст, который можно отправить контакту как есть.",
].join("\n");

function stripOuterQuotes(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-zA-Z]*\n?/i, "").replace(/\n?```\s*$/i, "");
  t = t.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("«") && t.endsWith("»"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export type ResolveNlOutboundOpts = {
  agentName: string;
  promptExtras: string;
  /** Уже извлечённый короткий первый текст из NL; если есть — полируем, иначе синтезируем из инструкций. */
  rawFirstMessage?: string | undefined;
  peerLabel: string;
};

/**
 * Текст первого исходящего в личный Telegram (после NL / create_agent).
 * При ошибке LLM — сырой черновик или укороченный prompt.
 */
export async function resolveNlOutboundTextForDialog(opts: ResolveNlOutboundOpts): Promise<string> {
  const polishOff = process.env.PRODUCT_BOT_NL_OUTBOUND_POLISH?.trim() === "0";
  const raw = opts.rawFirstMessage?.trim();
  if (raw && polishOff) return raw.slice(0, 4096);

  const maxTok = Math.min(
    600,
    Math.max(200, Number(process.env.PRODUCT_BOT_NL_OUTBOUND_MAX_TOKENS) || 400),
  );

  const userParts = [
    `Агент (имя): ${opts.agentName.trim()}`,
    `Контакт: ${opts.peerLabel.trim()}`,
    "",
    "Инструкции агента / контекст:",
    opts.promptExtras.trim().slice(0, 3500),
  ];
  if (raw) {
    userParts.push("", "Черновик первого сообщения (перепиши при необходимости короче и естественнее):", raw.slice(0, 2000));
  } else {
    userParts.push("", "Черновика первого сообщения нет — сформулируй одно первое сообщение контакту по инструкциям выше.");
  }

  try {
    const messages: ChatMsg[] = [
      { role: "system", content: OUTBOUND_SYSTEM },
      { role: "user", content: userParts.join("\n") },
    ];
    const { content } = await runChatCompletion(messages, { maxTokens: maxTok, temperature: 0.35 });
    const cleaned = stripOuterQuotes(content).slice(0, 4096);
    if (cleaned.length >= 8) return cleaned;
  } catch {
    /* fallthrough */
  }
  if (raw) return raw.slice(0, 4096);
  return opts.promptExtras.trim().slice(0, 800).slice(0, 4096);
}
