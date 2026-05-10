import { randomUUID } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { signCabinetToken, COOKIE_NAME } from "../lib/cabinetJwt.js";
import { hashPassword, verifyPassword } from "../lib/passwordHash.js";
import { requireCabinetUser } from "../middleware/cabinetAuth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { verifyTelegramLoginWidget, flattenQueryStringRecord } from "../lib/telegramWidgetAuth.js";
import { ensureGuestTgAccount } from "../lib/ensureGuestTgAccount.js";
import {
  ensureCabinetSubscription,
  getCabinetSubscription,
  subscriptionGrantsPaidFeatures,
} from "../lib/cabinetSubscription.js";
import { MONTHLY_PRICE_RUB, TRIAL_MS } from "../lib/billingPricing.js";
import { yookassaTestPaymentsEnabled } from "../lib/yookassaClient.js";

const defaultTgPolicyJson = JSON.stringify({
  sendAllowed: false,
  markReadAllowed: true,
  replyMode: "manual",
  autoInGroups: false,
  agentScope: "allowlist",
});

const r = Router();

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Страница после Telegram Login Widget (`?next=connect.html`). Только безопасные имена *.html */
function resolveTelegramLoginLanding(nextRaw: string): string {
  const def = (process.env.PRODUCT_CABINET_PATH?.trim() || "cabinet.html").replace(/^\//, "");
  const n = nextRaw.trim().replace(/^\//, "");
  if (!n) return def;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.html$/.test(n)) return def;
  return n;
}

/** Публичные данные для встраивания Telegram Login Widget (без секретов). */
r.get("/bootstrap-public", (_req, res) => {
  const username = process.env.PRODUCT_BOT_USERNAME?.trim().replace(/^@/, "") || "";
  const token = process.env.PRODUCT_BOT_TOKEN?.trim();
  res.json({
    telegramBotUsername: username || null,
    telegramLoginAvailable: Boolean(username && token),
  });
});

/**
 * Callback Telegram Login Widget: проверка подписи → JWT cookie → редирект в кабинет.
 * В @BotFather для бота: /setdomain → домен сайта (для localhost — как в доке Telegram).
 */
r.get(
  "/telegram-callback",
  asyncHandler(async (req, res) => {
    const flat = flattenQueryStringRecord(req.query as Record<string, unknown>);
    const landingHtml = resolveTelegramLoginLanding(String(flat.next ?? ""));
    const verifyFlat = { ...flat };
    delete verifyFlat.next;

    const botToken = process.env.PRODUCT_BOT_TOKEN?.trim();
    const base = (process.env.PRODUCT_PUBLIC_BASE_URL || process.env.CABINET_PUBLIC_URL || "").replace(/\/$/, "");

    const redirectWith = (query: Record<string, string>) => {
      const sp = new URLSearchParams(query).toString();
      const rel = `/${landingHtml}${sp ? `?${sp}` : ""}`;
      res.redirect(302, base ? `${base}${rel}` : rel);
    };

    if (!botToken) {
      redirectWith({ tg_err: "no_bot_token" });
      return;
    }
    if (!verifyTelegramLoginWidget(verifyFlat, botToken)) {
      redirectWith({ tg_err: "bad_signature" });
      return;
    }
    const idNum = Number(flat.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      redirectWith({ tg_err: "bad_id" });
      return;
    }
    const appUserId = `bot-${idNum}`;
    await ensureGuestTgAccount(appUserId);

    const email = `tg_${idNum}@telegram.cabinet`;
    let user = await prisma.cabinetUser.findUnique({ where: { appUserId } });
    if (!user) {
      user = await prisma.cabinetUser.create({
        data: {
          email,
          passwordHash: null,
          appUserId,
        },
      });
    }
    await ensureCabinetSubscription(user.id, user.appUserId);

    const jwt = await signCabinetToken({
      sub: user.id,
      email: user.email,
      appUserId: user.appUserId,
    });
    const secure = process.env.NODE_ENV === "production";
    res.cookie(COOKIE_NAME, jwt, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    redirectWith({ tg_ok: "1" });
  }),
);

r.post("/register", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const appUserId = String(req.body?.appUserId || "").trim();
  if (!emailRe.test(email)) {
    res.status(400).json({ error: "Некорректный email" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Пароль минимум 8 символов" });
    return;
  }
  if (!appUserId) {
    res.status(400).json({ error: "appUserId обязателен (как в connector/.env)" });
    return;
  }
  const tg = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!tg) {
    if (/^bot-\d+$/.test(appUserId)) {
      res.status(400).json({
        error:
          "ID вида bot-… из бота — это гостевой идентификатор до привязки личного Telegram. В поле регистрации его использовать нельзя. Сделайте: ensure-account с appUserId из connector/.env → login.py → привязку (internal/link-telegram-user-to-account, см. README). После привязки снова «Личный кабинет» или /id в боте — скопируйте строку уже без префикса bot-.",
      });
      return;
    }
    res.status(400).json({
      error:
        "Аккаунт в БД не найден для этого appUserId. Выполните POST /internal/ensure-account с заголовком X-Connector-Secret и тем же appUserId, затем login.py в connector (см. telegram-user/README.md).",
    });
    return;
  }
  const exists = await prisma.cabinetUser.findFirst({
    where: { OR: [{ email }, { appUserId }] },
  });
  if (exists) {
    res.status(409).json({ error: "Email или appUserId уже зарегистрированы" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.cabinetUser.create({
    data: { email, passwordHash, appUserId },
  });
  let token: string;
  try {
    token = await signCabinetToken({
      sub: user.id,
      email: user.email,
      appUserId: user.appUserId,
    });
  } catch (e) {
    await prisma.cabinetUser.delete({ where: { id: user.id } }).catch(() => {});
    res.status(500).json({ error: e instanceof Error ? e.message : "JWT error" });
    return;
  }
  const secure = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.status(201).json({
    user: { id: user.id, email: user.email, appUserId: user.appUserId },
    token,
  });
});

/**
 * Регистрация с нуля на сайте: создаётся appUserId, TgAccount и подписка с 1 сутками триала (доступ к MTProto).
 * После триала — оплата 500 ₽ / мес в кабинете (ЮKassa или тестовая кнопка).
 */
r.post("/register-web", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!emailRe.test(email)) {
    res.status(400).json({ error: "Некорректный email" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Пароль минимум 8 символов" });
    return;
  }
  const taken = await prisma.cabinetUser.findUnique({ where: { email } });
  if (taken) {
    res.status(409).json({ error: "Этот email уже зарегистрирован — войдите или восстановите доступ." });
    return;
  }
  const appUserId = `user-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const trialEndsAt = new Date(Date.now() + TRIAL_MS);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      await tx.tgAccount.create({
        data: {
          appUserId,
          sessionEnc: Buffer.alloc(0),
          policyJson: defaultTgPolicyJson,
          status: "pending_auth",
        },
      });
      const cab = await tx.cabinetUser.create({
        data: { email, passwordHash, appUserId },
      });
      await tx.cabinetSubscription.create({
        data: {
          cabinetUserId: cab.id,
          status: "trialing",
          planCode: "monthly",
          trialEndsAt,
        },
      });
      return cab;
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "create failed" });
    return;
  }
  let token: string;
  try {
    token = await signCabinetToken({
      sub: user.id,
      email: user.email,
      appUserId: user.appUserId,
    });
  } catch (e) {
    await prisma.cabinetUser.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.tgAccount.delete({ where: { appUserId: user.appUserId } }).catch(() => {});
    res.status(500).json({ error: e instanceof Error ? e.message : "JWT error" });
    return;
  }
  const secure = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.status(201).json({
    user: { id: user.id, email: user.email, appUserId: user.appUserId },
    token,
    trialEndsAt: trialEndsAt.toISOString(),
    nextSteps: [
      "Бесплатно 1 день с момента регистрации — подключите личный Telegram в кабинете (блок «Личный Telegram» слева).",
      `После окончания триала — ${MONTHLY_PRICE_RUB} ₽ за месяц в блоке «Статус» (оплата через ЮKassa / ЮMoney или тестовая кнопка на стенде).`,
    ],
  });
});

r.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    res.status(400).json({ error: "email и password обязательны" });
    return;
  }
  const user = await prisma.cabinetUser.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }
  if (user.passwordHash == null) {
    res.status(401).json({
      error:
        "Вход только через Telegram: на сайте нажмите «Вход через Telegram» (лендинг или страница кабинета).",
    });
    return;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }
  let token: string;
  try {
    token = await signCabinetToken({
      sub: user.id,
      email: user.email,
      appUserId: user.appUserId,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "JWT error" });
    return;
  }
  const secure = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({
    user: { id: user.id, email: user.email, appUserId: user.appUserId },
    token,
  });
});

r.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

r.get("/me", requireCabinetUser, async (req, res) => {
  const u = req.cabinetUser!;
  const tg = await prisma.tgAccount.findUnique({ where: { appUserId: u.appUserId } });
  const sub = await getCabinetSubscription(u.id, u.appUserId);
  const now = new Date();
  const hasAccess = subscriptionGrantsPaidFeatures(sub);
  const trialActive = sub.status === "trialing" && !!sub.trialEndsAt && sub.trialEndsAt > now;
  const paidMonthly =
    sub.status === "active" && (!sub.currentPeriodEnd || sub.currentPeriodEnd > now);
  const step2 = hasAccess;
  const step3 = tg?.status === "active";
  res.json({
    user: { id: u.id, email: u.email, appUserId: u.appUserId },
    telegram: tg
      ? {
          accountId: tg.id,
          status: tg.status,
          lastError: tg.lastError,
        }
      : null,
    subscription: {
      status: sub.status,
      planCode: sub.planCode,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      trialActive,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      hasAccess,
      paid: paidMonthly,
      priceMonthlyRub: MONTHLY_PRICE_RUB,
      nextPaymentDueAt: paidMonthly ? sub.currentPeriodEnd?.toISOString() ?? null : null,
    },
    onboarding: {
      step1_accountDone: true,
      step2_paymentDone: step2,
      step3_telegramMtprotoDone: step3,
      appUserId: u.appUserId,
      hint: trialActive
        ? `Триал активен до ${sub.trialEndsAt?.toISOString() ?? "—"}. Успейте подключить личный Telegram. После триала — ${MONTHLY_PRICE_RUB} ₽ / мес в блоке «Статус».`
        : paidMonthly
          ? "Подключите личный Telegram в кабинете или в боте; на сервере должен работать worker — появятся диалоги и автоответы."
          : `Оплатите ${MONTHLY_PRICE_RUB} ₽ за месяц в блоке «Статус», затем подключите личный Telegram.`,
    },
    billing: {
      simulatedPaymentAvailable: process.env.BILLING_ALLOW_SIMULATED_PAYMENT === "1",
      yookassaConfigured: Boolean(
        process.env.YOOKASSA_SHOP_ID?.trim() && process.env.YOOKASSA_SECRET_KEY?.trim(),
      ),
      yookassaTestPayments: yookassaTestPaymentsEnabled(),
    },
  });
});

export default r;
