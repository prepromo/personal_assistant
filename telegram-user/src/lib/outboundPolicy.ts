/**
 * Исходящие в личный Telegram (TgPendingSend) по HTTP должны совпадать с правилом бота:
 * по умолчанию только после подтверждения в боте. Для отладки/интеграций — явный флаг env.
 */
export function allowUnconfirmedHttpOutbound(): boolean {
  return process.env.ALLOW_UNCONFIRMED_HTTP_OUTBOUND === "1";
}
