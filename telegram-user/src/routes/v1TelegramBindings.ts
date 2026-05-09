import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAgentToken } from "../middleware/agentAuth.js";

const r = Router();
r.use(requireAgentToken);

const TG_ID_RE = /^\d{1,20}$/;

function parseTelegramUserId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!TG_ID_RE.test(s)) return null;
  return s;
}

/** Резолв: Telegram user id → appUserId и (если есть) TgAccount.id */
r.get("/telegram-bindings/:telegramUserId", async (req, res) => {
  const telegramUserId = parseTelegramUserId(req.params.telegramUserId);
  if (!telegramUserId) {
    res.status(400).json({ error: "telegramUserId: ожидается числовой id Telegram (1..20 цифр)" });
    return;
  }
  const row = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId } });
  if (!row) {
    res.status(404).json({ error: "Привязка не найдена" });
    return;
  }
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId: row.appUserId } });
  res.json({
    telegramUserId: row.telegramUserId,
    appUserId: row.appUserId,
    accountId: acc?.id ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
});

/** Upsert привязки telegram user id → appUserId */
r.put("/telegram-bindings/:telegramUserId", async (req, res) => {
  const telegramUserId = parseTelegramUserId(req.params.telegramUserId);
  if (!telegramUserId) {
    res.status(400).json({ error: "telegramUserId: ожидается числовой id Telegram (1..20 цифр)" });
    return;
  }
  const appUserId = String(req.body?.appUserId || "").trim();
  if (!appUserId || appUserId.length > 256) {
    res.status(400).json({ error: "appUserId обязателен, до 256 символов" });
    return;
  }

  const row = await prisma.tgBotUserBinding.upsert({
    where: { telegramUserId },
    create: { telegramUserId, appUserId },
    update: { appUserId },
  });
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId: row.appUserId } });
  res.status(200).json({
    telegramUserId: row.telegramUserId,
    appUserId: row.appUserId,
    accountId: acc?.id ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
});

r.delete("/telegram-bindings/:telegramUserId", async (req, res) => {
  const telegramUserId = parseTelegramUserId(req.params.telegramUserId);
  if (!telegramUserId) {
    res.status(400).json({ error: "telegramUserId: ожидается числовой id Telegram (1..20 цифр)" });
    return;
  }
  const del = await prisma.tgBotUserBinding.deleteMany({ where: { telegramUserId } });
  if (del.count === 0) {
    res.status(404).json({ error: "Привязка не найдена" });
    return;
  }
  res.status(204).send();
});

/** TgAccount по appUserId — для invoke dialogs-list / messages-list */
r.get("/app-users/:appUserId/tg-account", async (req, res) => {
  const appUserId = String(req.params.appUserId || "").trim();
  if (!appUserId) {
    res.status(400).json({ error: "appUserId" });
    return;
  }
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc) {
    res.status(404).json({ error: "TgAccount не найден — сначала ensure-account и login в connector" });
    return;
  }
  res.json({
    accountId: acc.id,
    appUserId: acc.appUserId,
    status: acc.status,
  });
});

export default r;
