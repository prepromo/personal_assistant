/**
 * Исходящие сообщения через Bot API (напоминания без TgAccount / MTProto).
 */

export async function sendProductBotMessage(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.PRODUCT_BOT_TOKEN?.trim();
  if (!token) return false;
  const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  const r = await fetch(u, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("telegram Bot sendMessage:", r.status, t);
    return false;
  }
  return true;
}

/** Inline-клавиатура (JSON как в Bot API). */
export async function sendProductBotMessageInline(
  chatId: string | number,
  text: string,
  replyMarkup: { inline_keyboard: { text: string; callback_data: string }[][] },
): Promise<boolean> {
  const token = process.env.PRODUCT_BOT_TOKEN?.trim();
  if (!token) return false;
  const u = new URL(`https://api.telegram.org/bot${token}/sendMessage`);
  const r = await fetch(u, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("telegram Bot sendMessage inline:", r.status, t);
    return false;
  }
  return true;
}
