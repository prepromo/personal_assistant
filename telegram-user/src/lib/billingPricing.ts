/** Цена помесячной подписки в кабинете (руб.), оплата через ЮKassa. */
export const MONTHLY_PRICE_RUB = 500;

/** Длительность пробного периода после register-web. */
export const TRIAL_MS = 24 * 60 * 60 * 1000;

export function monthlyAmountString(): string {
  return `${MONTHLY_PRICE_RUB}.00`;
}
