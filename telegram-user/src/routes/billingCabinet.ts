import { randomUUID } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireCabinetUser } from "../middleware/cabinetAuth.js";
import {
  addMonth,
  getCabinetSubscription,
  subscriptionGrantsPaidFeatures,
} from "../lib/cabinetSubscription.js";
import { monthlyAmountString, MONTHLY_PRICE_RUB } from "../lib/billingPricing.js";
import {
  yookassaConfigured,
  yookassaCreateRedirectPayment,
  yookassaGetPayment,
} from "../lib/yookassaClient.js";

function simulatedPaymentAllowed(): boolean {
  return process.env.BILLING_ALLOW_SIMULATED_PAYMENT === "1";
}

function cabinetPublicBase(): string {
  const base =
    process.env.CABINET_PUBLIC_URL?.trim() ||
    process.env.PRODUCT_PUBLIC_BASE_URL?.trim() ||
    "";
  return base.replace(/\/$/, "");
}

function paymentReturnUrl(): string {
  const base = cabinetPublicBase();
  const path = (process.env.PRODUCT_CABINET_PATH?.trim() || "cabinet.html").replace(/^\//, "");
  const suffix = `${path}?payment=return`;
  return base ? `${base}/${suffix}` : `/${suffix}`;
}

/** Публичный webhook ЮKassa — без JWT; проверяем платёж через API. */
const webhook = Router();
webhook.post("/billing/yookassa-webhook", async (req, res) => {
  if (!yookassaConfigured()) {
    res.status(503).json({ error: "ЮKassa не настроена" });
    return;
  }
  const expectedSecret = process.env.YOOKASSA_WEBHOOK_SECRET?.trim();
  if (expectedSecret) {
    const got =
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() ||
      String(req.query.secret || "").trim();
    if (got !== expectedSecret) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }

  const body = req.body as Record<string, unknown>;
  const event = String(body?.event ?? "");
  const obj = body?.object as Record<string, unknown> | undefined;
  const paymentId = obj?.id != null ? String(obj.id) : "";

  if (!paymentId || event !== "payment.succeeded") {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  try {
    const pay = await yookassaGetPayment(paymentId);
    if (!pay.paid) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    const cabinetUserId = pay.metadata.cabinetUserId?.trim();
    if (!cabinetUserId) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    const user = await prisma.cabinetUser.findUnique({ where: { id: cabinetUserId } });
    if (!user) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    const now = new Date();
    await prisma.cabinetSubscription.update({
      where: { cabinetUserId: user.id },
      data: {
        status: "active",
        trialEndsAt: null,
        currentPeriodEnd: addMonth(now),
        planCode: "monthly",
      },
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[yookassa-webhook]", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "webhook error" });
  }
});

const authed = Router();
authed.use(requireCabinetUser);

authed.get("/billing", async (req, res) => {
  const u = req.cabinetUser!;
  const sub = await getCabinetSubscription(u.id, u.appUserId);
  const trialActive = sub.status === "trialing" && !!sub.trialEndsAt && sub.trialEndsAt > new Date();
  const paidActive =
    sub.status === "active" &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd > now);
  const hasAccess = subscriptionGrantsPaidFeatures(sub);

  res.json({
    status: sub.status,
    planCode: sub.planCode,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    trialActive,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    paid: paidActive,
    hasAccess,
    priceMonthlyRub: MONTHLY_PRICE_RUB,
    nextPaymentDueAt: paidActive ? sub.currentPeriodEnd?.toISOString() ?? null : null,
    simulatedPaymentAvailable: simulatedPaymentAllowed(),
    yookassaConfigured: yookassaConfigured(),
  });
});

authed.post("/billing/create-payment", async (req, res) => {
  const u = req.cabinetUser!;
  if (!yookassaConfigured()) {
    res.status(503).json({ error: "ЮKassa не настроена на сервере (YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY)." });
    return;
  }

  const sub = await getCabinetSubscription(u.id, u.appUserId);
  const now = new Date();
  if (sub.status === "active" && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
    res.status(400).json({ error: "Подписка уже оплачена до " + sub.currentPeriodEnd.toISOString() });
    return;
  }

  try {
    const retUrl = paymentReturnUrl();
    const created = await yookassaCreateRedirectPayment({
      amountRub: monthlyAmountString(),
      description: `Comrade AI — месяц (${MONTHLY_PRICE_RUB} ₽)`,
      returnUrl: retUrl,
      metadata: { cabinetUserId: u.id, appUserId: u.appUserId },
      idempotenceKey: randomUUID(),
    });
    if (!created.confirmationUrl) {
      res.status(502).json({ error: "ЮKassa не вернула URL оплаты", paymentId: created.id });
      return;
    }
    res.json({
      confirmationUrl: created.confirmationUrl,
      paymentId: created.id,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

authed.post("/billing/complete-monthly", async (req, res) => {
  const u = req.cabinetUser!;
  await getCabinetSubscription(u.id, u.appUserId);

  if (!simulatedPaymentAllowed()) {
    if (yookassaConfigured()) {
      res.status(400).json({
        error: "Тестовая оплата выключена. Нажмите «Оплатить месяц» — откроется форма ЮKassa.",
      });
      return;
    }
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
      trialEndsAt: null,
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

const billingCabinetRoutes = Router();
billingCabinetRoutes.use(webhook);
billingCabinetRoutes.use(authed);

export default billingCabinetRoutes;
