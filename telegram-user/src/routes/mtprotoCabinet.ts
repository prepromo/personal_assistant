import { Router } from "express";
import { requireCabinetUser } from "../middleware/cabinetAuth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getCabinetSubscription, subscriptionBlocksPaidFeatures } from "../lib/cabinetSubscription.js";
import {
  mtprotoPassword,
  mtprotoSendCode,
  mtprotoSignIn,
  needsTelegramMtprotoLogin,
  subscriptionActiveForAppUserId,
} from "../lib/mtprotoLoginService.js";
import { prisma } from "../lib/prisma.js";

const r = Router();
r.use(requireCabinetUser);

r.get(
  "/mtproto/status",
  asyncHandler(async (req, res) => {
    const u = req.cabinetUser!;
    const sub = await getCabinetSubscription(u.id, u.appUserId);
    const paid = !subscriptionBlocksPaidFeatures(sub);
    const tg = await prisma.tgAccount.findUnique({ where: { appUserId: u.appUserId } });
    const needs = await needsTelegramMtprotoLogin(u.appUserId);
    res.json({
      paid,
      subscriptionStatus: sub.status,
      telegram: tg
        ? {
            status: tg.status,
            hasSession: tg.sessionEnc.length > 0,
          }
        : null,
      needsLogin: paid && needs,
    });
  }),
);

r.post(
  "/mtproto/login/start",
  asyncHandler(async (req, res) => {
    const u = req.cabinetUser!;
    const sub = await getCabinetSubscription(u.id, u.appUserId);
    if (subscriptionBlocksPaidFeatures(sub)) {
      res.status(402).json({ error: "Сначала оплатите тариф в кабинете.", code: "subscription_required" });
      return;
    }
    const phone = String(req.body?.phone || "").trim();
    if (!phone) {
      res.status(400).json({ error: "phone обязателен (формат +79991234567)" });
      return;
    }
    try {
      await mtprotoSendCode(u.appUserId, phone);
      res.json({ ok: true, message: "Код отправлен в Telegram на этот номер." });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }),
);

r.post(
  "/mtproto/login/confirm",
  asyncHandler(async (req, res) => {
    const u = req.cabinetUser!;
    if (!(await subscriptionActiveForAppUserId(u.appUserId))) {
      res.status(402).json({ error: "Нужна активная подписка.", code: "subscription_required" });
      return;
    }
    const code = String(req.body?.code || "").trim();
    if (!code) {
      res.status(400).json({ error: "code обязателен" });
      return;
    }
    try {
      const r2 = await mtprotoSignIn(u.appUserId, code);
      if (r2.needPassword) {
        res.json({ ok: true, needPassword: true, message: "Введите пароль двухфакторной защиты Telegram." });
        return;
      }
      res.json({
        ok: true,
        needPassword: false,
        message:
          "Личный Telegram подключён. Worker — отдельный процесс на сервере с API; запустите его, чтобы подтянулись диалоги.",
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }),
);

r.post(
  "/mtproto/login/password",
  asyncHandler(async (req, res) => {
    const u = req.cabinetUser!;
    if (!(await subscriptionActiveForAppUserId(u.appUserId))) {
      res.status(402).json({ error: "Нужна активная подписка.", code: "subscription_required" });
      return;
    }
    const password = String(req.body?.password ?? "");
    if (!password) {
      res.status(400).json({ error: "password обязателен" });
      return;
    }
    try {
      await mtprotoPassword(u.appUserId, password);
      res.json({
        ok: true,
        message:
          "Личный Telegram подключён. Запустите worker отдельно на сервере с API — подтянутся диалоги.",
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }),
);

export default r;
