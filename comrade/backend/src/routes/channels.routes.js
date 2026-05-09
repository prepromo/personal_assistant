import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { encryptJson } from "../services/encryption.service.js";
import { validateTelegramToken } from "../services/telegram.service.js";
import { ensureTelegramPoll } from "../services/telegram-ingest.service.js";

const r = Router();
r.use(authRequired);

r.get("/", async (req, res) => {
  const list = await prisma.channel.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      name: true,
      status: true,
      createdAt: true,
    },
  });
  res.json({ channels: list });
});

r.post("/telegram", async (req, res) => {
  const { botToken, name } = req.body || {};
  if (!botToken) {
    return res.status(400).json({ error: "botToken required" });
  }
  let bot;
  try {
    bot = await validateTelegramToken(String(botToken).trim());
  } catch (e) {
    return res.status(400).json({ error: e.message || "Telegram validation failed" });
  }

  const configEnc = encryptJson({ botToken: String(botToken).trim() });
  const channel = await prisma.channel.create({
    data: {
      userId: req.userId,
      type: "telegram",
      name: name || `@${bot.username}`,
      configEnc,
      status: "active",
    },
  });

  ensureTelegramPoll(channel.id);

  res.status(201).json({
    channel: {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      status: channel.status,
    },
  });
});

/** Stubs for other channels */
r.post("/whatsapp", async (_req, res) => {
  res.status(501).json({ error: "WhatsApp — скоро в Comrade", code: "NOT_IMPLEMENTED" });
});
r.post("/email", async (_req, res) => {
  res.status(501).json({ error: "Email — скоро в Comrade", code: "NOT_IMPLEMENTED" });
});
r.post("/max", async (_req, res) => {
  res.status(501).json({ error: "MAX — скоро в Comrade", code: "NOT_IMPLEMENTED" });
});

export default r;
