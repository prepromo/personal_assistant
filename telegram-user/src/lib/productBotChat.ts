import { runChatCompletion, type ChatMsg } from "./llm/chatCompletion.js";

const DEFAULT_SYSTEM = [
  "Ты — помощник в Telegram-боте настройки личного аккаунта.",
  "Отвечай кратко и по делу на языке пользователя (чаще русский).",
  "Ты помогаешь с: до 5 логическими «агентами» (инструкции для автоответов с личного Telegram), политикой автоответов (manual / suggest / auto, группы, список чатов), заметками, напоминаниями, подписками на новости.",
  "КРИТИЧНО: ты только отвечаешь текстом в этом чате. Ты НЕ выполняешь код и НЕ меняешь базу сам. Никогда не говори «создал», «готово», «отправил», если речь о действиях в приложении — так пользователь введёт в заблуждение.",
  "Если пользователь уже подтвердил действие и бот прислал системное сообщение (агент создан, чат привязан и т.д.) — не отрицай это: изменения пишутся в БД. Первое исходящее в привязанные чаты из NL по умолчанию **ставится в очередь** (нужны worker и sendAllowed в политике); при PRODUCT_BOT_NL_AUTO_OUTBOUND=0 — только ручной путь «Написать первым» / «Отправить».",
  "Автоответы агента на входящие от людей — это отдельно: режим чата manual/suggest/auto и автоматизация; агент сам не «пишет первым» без очереди исходящего.",
  "Основной способ сделать действие — описать задачу обычным языком: бот распознаёт намерение и показывает кнопку «Подтвердить». НЕ перечисляй пошагово «открой /agents», «нажми Создать агента» и т.п., если пользователь уже формулирует задачу (создать агента, напоминание, режим чата, новости). В таких случаях скажи в 1–2 предложениях: отправьте тот же или уточнённый запрос — появится черновик с подтверждением; кнопки меню — запасной способ.",
  "Не отвечай блоками кода (markdown ```) и длинными скриптами — в этом чате они не выполняются.",
  "Если пользователь просит только объяснить или болтает без задачи — отвечай как помощник. Если спрашивает «как сделать вручную» — можно кратко упомянуть разделы меню.",
  "Не выдумывай факты о чужих чатах и настройках. Не придумывай API вроде get_contact() — такого в этом чате нет.",
  "2–10 предложений максимум, без вступлений вроде «Конечно!» и без лишних извинений.",
].join(" ");

export type ProductChatTurn = { role: "user" | "assistant"; content: string };

function chatOptions() {
  const maxTokens = Math.min(
    4096,
    Math.max(128, Number(process.env.PRODUCT_BOT_CHAT_MAX_TOKENS) || 1024),
  );
  const temperature = Math.min(1, Math.max(0, Number(process.env.PRODUCT_BOT_CHAT_TEMPERATURE) || 0.45));
  return { maxTokens, temperature };
}

/** Последние пары user/assistant, не больше maxMsgs (по умолчанию 24 реплики). */
export function trimProductChatHistory(history: ProductChatTurn[]): ProductChatTurn[] {
  const maxMsgs = Math.max(4, Math.min(48, Number(process.env.PRODUCT_BOT_CHAT_MAX_MSGS) || 24));
  if (history.length <= maxMsgs) return history;
  return history.slice(-maxMsgs);
}

function systemMessage(): ChatMsg {
  const custom = process.env.PRODUCT_BOT_CHAT_SYSTEM?.trim();
  return { role: "system", content: custom || DEFAULT_SYSTEM };
}

/**
 * Один ход диалога в личке с продуктовым ботом (GigaChat через тот же chatCompletion, что и кабинет).
 */
export async function runProductBotChatTurn(
  userText: string,
  history: ProductChatTurn[],
): Promise<{ content: string; provider: string }> {
  const trimmed = trimProductChatHistory(history);
  const messages: ChatMsg[] = [
    systemMessage(),
    ...trimmed.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText.slice(0, 4000) },
  ];
  return runChatCompletion(messages, chatOptions());
}

export function appendProductChatTurn(
  history: ProductChatTurn[] | undefined,
  userText: string,
  assistantText: string,
): ProductChatTurn[] {
  const h = history ?? [];
  return trimProductChatHistory([
    ...h,
    { role: "user", content: userText.slice(0, 4000) },
    { role: "assistant", content: assistantText.slice(0, 8000) },
  ]);
}

export function isProductBotChatDisabled(): boolean {
  const v = process.env.PRODUCT_BOT_CHAT_DISABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
