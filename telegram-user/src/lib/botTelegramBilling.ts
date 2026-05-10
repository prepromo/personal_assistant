import { prisma } from "./prisma.js";
import { addMonth, getCabinetSubscription } from "./cabinetSubscription.js";

export async function getCabinetUserIdForTelegramUser(telegramUserId: number): Promise<string | null> {
  const tid = String(telegramUserId);
  const binding = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!binding) return null;
  const cab = await prisma.cabinetUser.findUnique({ where: { appUserId: binding.appUserId } });
  return cab?.id ?? null;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

const CAB_PAYLOAD_PREFIX = "cab_sub:";

export function buildSubscriptionInvoicePayload(cabinetUserId: string): string {
  return `${CAB_PAYLOAD_PREFIX}${cabinetUserId}`;
}

export function parseCabinetUserIdFromInvoicePayload(payload: string): string | null {
  if (!payload.startsWith(CAB_PAYLOAD_PREFIX)) return null;
  const id = payload.slice(CAB_PAYLOAD_PREFIX.length).trim();
  return id || null;
}

/** Бонус к периоду при тестовой активации из бота (дни). */
export function billingTestBonusDays(): number {
  const n = Number(process.env.BILLING_TEST_BONUS_DAYS);
  if (!Number.isFinite(n) || n < 0) return 7;
  return Math.min(90, Math.floor(n));
}

/**
 * Тестовая «оплата» месяца из бота (как /api/v1/cabinet/billing/complete-monthly), плюс бонус-дни к концу периода.
 */
export async function activateSimulatedMonthlyForTelegramUser(
  telegramUserId: number,
): Promise<{ ok: true; until: string } | { ok: false; error: string }> {
  if (process.env.BILLING_ALLOW_SIMULATED_PAYMENT !== "1") {
    return {
      ok: false,
      error: "Тестовая оплата выключена. Задайте на сервере BILLING_ALLOW_SIMULATED_PAYMENT=1.",
    };
  }
  if (process.env.YOOKASSA_SHOP_ID?.trim() && process.env.YOOKASSA_SECRET_KEY?.trim()) {
    return {
      ok: false,
      error: "На сервере задана ЮKassa — тест из бота отключён. Уберите ключи для стенда или оплатите в кабинете.",
    };
  }
  const tid = String(telegramUserId);
  const binding = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!binding) return { ok: false, error: "Сначала нажмите /start." };
  const cab = await prisma.cabinetUser.findUnique({ where: { appUserId: binding.appUserId } });
  if (!cab) return { ok: false, error: "Сначала /register — нужна запись аккаунта." };
  await getCabinetSubscription(cab.id, cab.appUserId);
  const bonus = billingTestBonusDays();
  const now = new Date();
  const sub = await prisma.cabinetSubscription.findUnique({ where: { cabinetUserId: cab.id } });
  let nextEnd: Date;
  if (sub?.status === "active" && sub.currentPeriodEnd) {
    nextEnd = addDays(new Date(sub.currentPeriodEnd), bonus);
  } else {
    nextEnd = addDays(addMonth(now), bonus);
  }
  await prisma.cabinetSubscription.update({
    where: { cabinetUserId: cab.id },
    data: {
      status: "active",
      trialEndsAt: null,
      currentPeriodEnd: nextEnd,
      planCode: "monthly_telegram_test",
    },
  });
  return { ok: true, until: nextEnd.toISOString() };
}

/** После успешной оплаты счёта в Telegram (Stars / провайдер). */
export async function activateAfterTelegramInvoicePayment(
  telegramUserId: number,
  invoicePayload: string,
): Promise<{ ok: true; until: string } | { ok: false; error: string }> {
  const cabinetUserId = parseCabinetUserIdFromInvoicePayload(invoicePayload);
  if (!cabinetUserId) return { ok: false, error: "bad_payload" };
  const tid = String(telegramUserId);
  const binding = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!binding) return { ok: false, error: "no_binding" };
  const cab = await prisma.cabinetUser.findUnique({ where: { id: cabinetUserId } });
  if (!cab || cab.appUserId !== binding.appUserId) return { ok: false, error: "wrong_account" };
  await getCabinetSubscription(cab.id, cab.appUserId);
  const bonus = billingTestBonusDays();
  const now = new Date();
  const sub = await prisma.cabinetSubscription.findUnique({ where: { cabinetUserId: cab.id } });
  let nextEnd: Date;
  if (sub?.status === "active" && sub.currentPeriodEnd) {
    nextEnd = addDays(new Date(sub.currentPeriodEnd), bonus);
  } else {
    nextEnd = addDays(addMonth(now), bonus);
  }
  await prisma.cabinetSubscription.update({
    where: { cabinetUserId: cab.id },
    data: {
      status: "active",
      trialEndsAt: null,
      currentPeriodEnd: nextEnd,
      planCode: "monthly_telegram_invoice",
    },
  });
  return { ok: true, until: nextEnd.toISOString() };
}
