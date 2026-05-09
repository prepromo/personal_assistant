import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { prisma } from "../lib/prisma.js";
import { encryptSession, decryptSession } from "../lib/sessionCrypto.js";
import { requireConnectorSecret } from "../middleware/connectorAuth.js";
import { explainInboundAutomationSkip } from "../lib/automation.js";
import { maybeScheduleAgentInboundReport } from "../lib/agentInboundReport.js";
import { defaultPolicy, parsePolicy } from "../lib/policy.js";

const r = Router();
r.use(requireConnectorSecret);

/** Создать аккаунт с пустой сессией (до login) */
r.post("/ensure-account", asyncHandler(async (req, res) => {
  const appUserId = String(req.body?.appUserId || "").trim();
  if (!appUserId) {
    res.status(400).json({ error: "appUserId обязателен" });
    return;
  }
  const existing = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (existing) {
    res.json({ accountId: existing.id, created: false });
    return;
  }
  const acc = await prisma.tgAccount.create({
    data: {
      appUserId,
      sessionEnc: Buffer.alloc(0),
      // Safe defaults: no auto-send, allowlist mode (empty = nothing automated).
      policyJson: JSON.stringify({
        sendAllowed: false,
        markReadAllowed: true,
        replyMode: "manual",
        autoInGroups: false,
        agentScope: "allowlist",
      }),
      status: "pending_auth",
    },
  });
  res.json({ accountId: acc.id, created: true });
}));

/** Сбросить сохранённую сессию (например после входа по токену бота по ошибке) */
r.post("/reset-session", asyncHandler(async (req, res) => {
  const appUserId = String(req.body?.appUserId || "").trim();
  const clearBotBindings = Boolean(req.body?.clearBotBindings);
  if (!appUserId) {
    res.status(400).json({ error: "appUserId обязателен" });
    return;
  }
  const existing = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!existing) {
    res.status(404).json({ error: "Аккаунт не найден" });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.tgAccount.update({
      where: { appUserId },
      data: { sessionEnc: Buffer.alloc(0), status: "pending_auth", lastError: null },
    });
    if (clearBotBindings) {
      await tx.tgBotUserBinding.deleteMany({ where: { appUserId } });
    }
  });
  res.json({ ok: true, accountId: existing.id, clearedBotBindings: clearBotBindings });
}));

/** Сохранить Pyrogram StringSession (после login.py) */
r.post("/session", asyncHandler(async (req, res) => {
  const appUserId = String(req.body?.appUserId || "").trim();
  const sessionString = String(req.body?.sessionString || "").trim();
  if (!appUserId || !sessionString) {
    res.status(400).json({ error: "appUserId и sessionString обязательны" });
    return;
  }
  const enc = encryptSession(sessionString);
  const acc = await prisma.tgAccount.update({
    where: { appUserId },
    data: { sessionEnc: new Uint8Array(enc), status: "active", lastError: null },
  });
  res.json({ ok: true, accountId: acc.id });
}));

/**
 * После login.py: привязать числовой Telegram user id к TgAccount.appUserId.
 * Обновляет TgBotUserBinding; переносит Task / Reminder / BotConnectedChat с гостевого bot-<id> на канонический appUserId.
 */
r.post("/link-telegram-user-to-account", asyncHandler(async (req, res) => {
  const appUserId = String(req.body?.appUserId || "").trim();
  const telegramUserId = String(req.body?.telegramUserId ?? "").trim();
  if (!appUserId || !telegramUserId) {
    res.status(400).json({ error: "appUserId и telegramUserId обязательны" });
    return;
  }
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc) {
    res.status(404).json({ error: "TgAccount не найден для appUserId" });
    return;
  }
  const oldGuestAppUserId = `bot-${telegramUserId}`;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.tgBotUserBinding.findUnique({ where: { telegramUserId } });
    const metaToKeep = existing?.metaJson && existing.metaJson !== "{}" ? existing.metaJson : "{}";

    await tx.task.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });
    await tx.reminder.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });
    await tx.botConnectedChat.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });

    await tx.cabinetUser.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });
    await tx.productAgent.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });
    await tx.userNote.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });
    await tx.newsSubscription.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });
    await tx.botChannelPost.updateMany({
      where: { appUserId: oldGuestAppUserId },
      data: { appUserId },
    });

    await tx.tgBotUserBinding.upsert({
      where: { telegramUserId },
      create: {
        telegramUserId,
        appUserId,
        metaJson: metaToKeep,
      },
      update: {
        appUserId,
        metaJson: metaToKeep,
      },
    });
  });

  res.json({ ok: true, appUserId, telegramUserId, accountId: acc.id });
}));

/** Отдать расшифрованную сессию воркеру (только localhost + коннектор-секрет) */
r.get("/session/:appUserId", asyncHandler(async (req, res) => {
  const appUserId = String(req.params.appUserId ?? "");
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc || acc.sessionEnc.length === 0) {
    res.status(404).json({ error: "Аккаунт или сессия не найдены" });
    return;
  }
  try {
    const sessionString = decryptSession(Buffer.from(acc.sessionEnc));
    res.json({ sessionString, accountId: acc.id });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
}));

r.get("/account-by-user", asyncHandler(async (req, res) => {
  const appUserId = String(req.query.appUserId || "").trim();
  if (!appUserId) {
    res.status(400).json({ error: "appUserId" });
    return;
  }
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc) {
    res.status(404).json({ error: "Аккаунт не найден" });
    return;
  }
  res.json({ accountId: acc.id, status: acc.status });
}));

/** Upsert диалога из коннектора */
r.post("/ingest/dialog", asyncHandler(async (req, res) => {
  const { accountId, peerKey, title, dialogType, lastMsgId, unreadLocal } = req.body || {};
  if (!accountId || !peerKey || !dialogType) {
    res.status(400).json({ error: "accountId, peerKey, dialogType обязательны" });
    return;
  }
  const dt = ["user", "group", "supergroup", "channel"].includes(String(dialogType))
    ? String(dialogType)
    : "user";
  const row = await prisma.tgDialog.upsert({
    where: { accountId_peerKey: { accountId: String(accountId), peerKey: String(peerKey) } },
    create: {
      accountId: String(accountId),
      peerKey: String(peerKey),
      title: title ?? null,
      dialogType: dt as "user" | "group" | "supergroup" | "channel",
      lastMsgId: lastMsgId != null ? Number(lastMsgId) : null,
      unreadLocal: unreadLocal != null ? Number(unreadLocal) : 0,
      lastSyncedAt: new Date(),
    },
    update: {
      title: title ?? undefined,
      lastMsgId: lastMsgId != null ? Number(lastMsgId) : undefined,
      unreadLocal: unreadLocal != null ? Number(unreadLocal) : undefined,
      lastSyncedAt: new Date(),
    },
  });
  res.json({ dialogId: row.id });
}));

/** Upsert сообщения */
r.post("/ingest/message", asyncHandler(async (req, res) => {
  const { accountId, dialogId, peerKey, tgMessageId, date, text, out } = req.body || {};
  if (!accountId || !tgMessageId || !date) {
    res.status(400).json({ error: "accountId, tgMessageId, date обязательны" });
    return;
  }
  let dId = dialogId as string | undefined;
  if (!dId && peerKey) {
    const d = await prisma.tgDialog.findUnique({
      where: { accountId_peerKey: { accountId: String(accountId), peerKey: String(peerKey) } },
    });
    dId = d?.id;
  }
  if (!dId) {
    res.status(400).json({ error: "dialogId или peerKey для существующего диалога" });
    return;
  }
  const msg = await prisma.tgMessage.upsert({
    where: { dialogId_tgMessageId: { dialogId: dId, tgMessageId: Number(tgMessageId) } },
    create: {
      accountId: String(accountId),
      dialogId: dId,
      tgMessageId: Number(tgMessageId),
      date: new Date(date),
      text: text != null ? String(text) : null,
      out: Boolean(out),
    },
    update: {
      text: text != null ? String(text) : undefined,
      out: Boolean(out),
    },
  });
  if (!msg.out) {
    void maybeScheduleAgentInboundReport({
      accountId: String(accountId),
      dialogId: dId,
      tgMessageId: Number(tgMessageId),
      outgoing: false,
    });
  }
  res.json({ messageId: msg.id });
}));

/** Пинг воркера (коннектор), для /health */
r.post("/worker-ping", asyncHandler(async (req, res) => {
  const accountId = String(req.body?.accountId || "").trim() || null;
  const appUserId = String(req.body?.appUserId || "").trim() || null;
  await prisma.workerPing.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      accountId,
      lastSeenAt: new Date(),
      metaJson: JSON.stringify({ appUserId }),
    },
    update: {
      accountId,
      lastSeenAt: new Date(),
      metaJson: JSON.stringify({ appUserId }),
    },
  });
  res.json({ ok: true });
}));

/**
 * Диагностика политики / старых job (connector / curl с X-Connector-Secret).
 * Автоответы по входящим в коде отключены; поле recentJobs — история из БД.
 * GET /internal/automation-debug?appUserId=user-...&dialogId=<uuid опционально>
 */
r.get("/automation-debug", asyncHandler(async (req, res) => {
  const appUserId = String(req.query.appUserId || "").trim();
  if (!appUserId) {
    res.status(400).json({ error: "Укажите appUserId" });
    return;
  }
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc) {
    res.status(404).json({ error: "TgAccount не найден для appUserId" });
    return;
  }
  const policy = { ...defaultPolicy(), ...parsePolicy(acc.policyJson) };
  const recentJobs = await prisma.tgAutomationJob.findMany({
    where: { accountId: acc.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      status: true,
      kind: true,
      error: true,
      createdAt: true,
      dialogId: true,
      triggerTgMessageId: true,
      productAgentId: true,
    },
  });
  const dialogId = String(req.query.dialogId || "").trim();
  let skipForDialog: string | null = null;
  if (dialogId) {
    skipForDialog = await explainInboundAutomationSkip({
      accountId: acc.id,
      dialogId,
      outgoing: false,
    });
  }
  const llmOk = Boolean(
    (process.env.OPENCLAW_GATEWAY_URL && process.env.OPENCLAW_GATEWAY_TOKEN) ||
      (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY),
  );
  res.json({
    accountId: acc.id,
    appUserId: acc.appUserId,
    policy,
    skipReasonForDialog: dialogId ? skipForDialog : null,
    note:
      dialogId && !skipForDialog
        ? "Политика разрешает бывший режим; постановка job по входящим отключена в коде."
        : skipForDialog || "Передайте dialogId=… из списка диалогов кабинета, чтобы проверить allowlist/личку.",
    llmConfigured: llmOk,
    recentJobs,
  });
}));

/** Очередь исходящих для воркера */
r.get("/pending-sends/:accountId", asyncHandler(async (req, res) => {
  const accountId = String(req.params.accountId ?? "");
  const rows = await prisma.tgPendingSend.findMany({
    where: { accountId, status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  res.json({ items: rows });
}));

r.patch("/pending-sends/:id", asyncHandler(async (req, res) => {
  const id = String(req.params.id ?? "");
  const { status, error } = req.body || {};
  await prisma.tgPendingSend.update({
    where: { id },
    data: {
      status: String(status || "sent"),
      error: error != null ? String(error) : null,
    },
  });
  res.json({ ok: true });
}));

export default r;
