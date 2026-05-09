/**
 * Telegram Bot API smoke test (does not store token in logs).
 */
export async function validateTelegramToken(botToken) {
  const url = `https://api.telegram.org/bot${botToken}/getMe`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || "Invalid bot token");
  }
  return data.result;
}
