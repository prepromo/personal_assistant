/**
 * Пока true — ЮKassa не вызывается, лимиты trial/подписка на AI не блокируют.
 * Для продакшена: BILLING_STUB=false и задайте YOOKASSA_*.
 */
export function isBillingStub() {
  return process.env.BILLING_STUB !== "false";
}
