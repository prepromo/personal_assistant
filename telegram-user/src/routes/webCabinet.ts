import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { parsePolicy, defaultPolicy, type ReplyMode, type AgentScope } from "../lib/policy.js";
import { requireCabinetUser } from "../middleware/cabinetAuth.js";
import { respondSubscriptionRequired } from "../lib/cabinetPaidGate.js";

const r = Router();
r.use(requireCabinetUser);

async function auditUi(accountId: string, action: string, resource: string | null, meta: object) {
  await prisma.tgAgentAuditLog.create({
    data: {
      accountId,
      actor: "user_ui",
      action,
      resource,
      metaJson: JSON.stringify(meta),
    },
  });
}

async function getAccountForUser(appUserId: string) {
  return prisma.tgAccount.findUnique({ where: { appUserId } });
}

r.get("/telegram", async (req, res) => {
  const u = req.cabinetUser!;
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const policy = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  res.json({
    accountId: tg.id,
    appUserId: tg.appUserId,
    status: tg.status,
    lastError: tg.lastError,
    policy,
  });
});

r.patch("/policy", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const cur = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  let replyMode = req.body?.replyMode as ReplyMode | undefined;
  const modes: ReplyMode[] = ["manual", "suggest", "auto"];
  if (replyMode !== undefined && !modes.includes(replyMode)) {
    res.status(400).json({ error: "replyMode: manual | suggest | auto" });
    return;
  }
  if (replyMode === "suggest" || replyMode === "auto") replyMode = "manual";
  const scopes: AgentScope[] = ["all", "allowlist"];
  const agentScope = req.body?.agentScope as AgentScope | undefined;
  if (agentScope !== undefined && !scopes.includes(agentScope)) {
    res.status(400).json({ error: "agentScope: all | allowlist" });
    return;
  }

  const next = {
    ...cur,
    ...(replyMode !== undefined ? { replyMode } : {}),
    ...(typeof req.body?.sendAllowed === "boolean" ? { sendAllowed: req.body.sendAllowed } : {}),
    ...(typeof req.body?.markReadAllowed === "boolean" ? { markReadAllowed: req.body.markReadAllowed } : {}),
    ...(typeof req.body?.autoInGroups === "boolean" ? { autoInGroups: req.body.autoInGroups } : {}),
    ...(agentScope !== undefined ? { agentScope } : {}),
  };
  await prisma.tgAccount.update({
    where: { id: tg.id },
    data: { policyJson: JSON.stringify(next) },
  });
  await auditUi(tg.id, "policy_update", null, { keys: Object.keys(req.body || {}) });
  res.json({ policy: next });
});

r.get("/agent-allowed-dialogs", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const policy = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  const rows = await prisma.tgAgentAllowedDialog.findMany({
    where: { accountId: tg.id },
    include: { dialog: true },
    orderBy: { createdAt: "asc" },
  });
  await auditUi(tg.id, "cabinet_list_agent_allowed_dialogs", null, { count: rows.length });
  res.json({
    agentScope: policy.agentScope ?? "all",
    items: rows.map((r) => ({
      dialogId: r.dialogId,
      peerKey: r.dialog.peerKey,
      title: r.dialog.title,
      dialogType: r.dialog.dialogType,
    })),
  });
});

r.put("/agent-allowed-dialogs", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const raw = req.body?.dialogIds;
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "dialogIds: массив UUID диалогов" });
    return;
  }
  const dialogIds = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (dialogIds.length) {
    const found = await prisma.tgDialog.findMany({
      where: { accountId: tg.id, id: { in: dialogIds } },
      select: { id: true },
    });
    if (found.length !== dialogIds.length) {
      res.status(400).json({ error: "Не все dialogId принадлежат вашему аккаунту" });
      return;
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.tgAgentAllowedDialog.deleteMany({ where: { accountId: tg.id } });
    for (const dialogId of dialogIds) {
      await tx.tgAgentAllowedDialog.create({ data: { accountId: tg.id, dialogId } });
    }
  });
  await auditUi(tg.id, "cabinet_put_agent_allowed_dialogs", null, { count: dialogIds.length });
  res.json({ ok: true, dialogIds });
});

r.get("/dialogs", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const accountId = tg.id;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const cursor = req.query.cursor as string | undefined;
  const since = req.query.since as string | undefined;

  const where: { accountId: string; updatedAt?: { gt: Date } } = { accountId };
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) where.updatedAt = { gt: d };
  }

  const items = await prisma.tgDialog.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { updatedAt: "desc" },
  });
  let nextCursor: string | null = null;
  let list = items;
  if (items.length > limit) {
    list = items.slice(0, limit);
    nextCursor = items[limit].id;
  }

  await auditUi(accountId, "list_dialogs", null, { limit, cursor: cursor ?? null, since: since ?? null });

  res.json({
    items: list.map((d) => ({
      id: d.id,
      peerKey: d.peerKey,
      title: d.title,
      dialogType: d.dialogType,
      unreadLocal: d.unreadLocal,
      lastSyncedAt: d.lastSyncedAt?.toISOString() ?? null,
      updatedAt: d.updatedAt.toISOString(),
    })),
    nextCursor,
    serverTime: new Date().toISOString(),
  });
});

r.get("/dialogs/:dialogId/messages", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const { dialogId } = req.params;
  const dialog = await prisma.tgDialog.findFirst({
    where: { id: dialogId, accountId: tg.id },
  });
  if (!dialog) {
    res.status(404).json({ error: "Диалог не найден" });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = req.query.beforeId as string | undefined;

  const where: { dialogId: string; id?: { lt: string } } = { dialogId };
  if (beforeId) where.id = { lt: beforeId };

  const msgs = await prisma.tgMessage.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
  });

  await auditUi(tg.id, "get_messages", dialogId, { limit, beforeId: beforeId ?? null });

  res.json({
    items: msgs.reverse().map((m) => ({
      id: m.id,
      tgMessageId: m.tgMessageId,
      date: m.date.toISOString(),
      text: m.text,
      out: m.out,
    })),
  });
});

r.post("/dialogs/:dialogId/send", async (req, res) => {
  const u = req.cabinetUser!;
  if (await respondSubscriptionRequired(res, u.id, u.appUserId)) return;
  const { allowUnconfirmedHttpOutbound } = await import("../lib/outboundPolicy.js");
  if (!allowUnconfirmedHttpOutbound()) {
    res.status(403).json({
      error: "outbound_requires_bot_confirm",
      message:
        "Отправка в личный Telegram из кабинета отключена: подтвердите текст в боте (кнопка «Отправить»). Для локальной отладки задайте ALLOW_UNCONFIRMED_HTTP_OUTBOUND=1.",
    });
    return;
  }
  const tg = await getAccountForUser(u.appUserId);
  if (!tg) {
    res.status(404).json({ error: "TgAccount не найден" });
    return;
  }
  const { dialogId } = req.params;
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 4096) {
    res.status(400).json({ error: "text 1..4096" });
    return;
  }

  const dialog = await prisma.tgDialog.findFirst({
    where: { id: dialogId, accountId: tg.id },
  });
  if (!dialog) {
    res.status(404).json({ error: "Диалог не найден" });
    return;
  }

  const policy = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  if (!policy.sendAllowed) {
    res.status(403).json({ error: "Отправка запрещена policyJson" });
    return;
  }

  const job = await prisma.tgPendingSend.create({
    data: {
      accountId: tg.id,
      peerKey: dialog.peerKey,
      text,
      status: "pending",
    },
  });

  await auditUi(tg.id, "queue_send", dialogId, { pendingId: job.id, len: text.length });

  res.status(202).json({ queued: true, tgMessageId: null, pendingId: job.id });
});

export default r;
