import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireCabinetUser } from "../middleware/cabinetAuth.js";
import { addMonth, getCabinetSubscription } from "../lib/cabinetSubscription.js";

const r = Router();
r.use(requireCabinetUser);

function simulatedPaymentAllowed(): boolean {
  return process.env.BILLING_ALLOW_SIMULATED_PAYMENT === "1";
}

/** Статус оплаты и дата окончания периода (помесячный тариф). */
r.get("/billing", async (req, res) => {
  const u = req.cabinetUser!;
  const sub = await getCabinetSubscription(u.id, u.appUserId);
  res.json({
    status: sub.status,
    planCode: sub.planCode,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    paid: sub.status === "active",
    nextPaymentDueAt: sub.status === "active" ? sub.currentPeriodEnd?.toISOString() ?? null : null,
    simulatedPaymentAvailable: simulatedPaymentAllowed(),
    yookassaConfigured: Boolean(process.env.YOOKASSA_SHOP_ID?.trim()),
  });
});

/**
 * Завершить оплату месяца. Прод: сюда позже вешается ЮKassa/webhook.
 * Сейчас: только если BILLING_ALLOW_SIMULATED_PAYMENT=1 (без ЮKassa).
 */
r.post("/billing/complete-monthly", async (req, res) => {
  const u = req.cabinetUser!;
  await getCabinetSubscription(u.id, u.appUserId);

  if (process.env.YOOKASSA_SHOP_ID?.trim()) {
    res.status(501).json({
      error:
        "ЮKassa задана в окружении, но сценарий оплаты из кабинета ещё не подключён. Используйте оплату через поддержку или отключите YOOKASSA_SHOP_ID для тестового режима.",
    });
    return;
  }
  if (!simulatedPaymentAllowed()) {
    res.status(403).json({
      error:
        "Тестовая оплата выключена. Для демо задайте BILLING_ALLOW_SIMULATED_PAYMENT=1 на сервере API (только для стенда).",
    });
    return;
  }

  const now = new Date();
  const sub = await prisma.cabinetSubscription.update({
    where: { cabinetUserId: u.id },
    data: {
      status: "active",
      currentPeriodEnd: addMonth(now),
    },
  });

  res.json({
    ok: true,
    subscription: {
      status: sub.status,
      planCode: sub.planCode,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    },
  });
});

export default r;
