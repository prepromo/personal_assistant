import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { parsePolicy, defaultPolicy, type ReplyMode, type AgentScope } from "../lib/policy.js";
import { requireAgentToken } from "../middleware/agentAuth.js";
import { allowedDialogIdsOrNull, isDialogAllowedForAgent } from "../lib/agentDialogAccess.js";

const r = Router();
r.use(requireAgentToken);

async function audit(accountId: string, action: string, resource: string | null, meta: object) {
  await prisma.tgAgentAuditLog.create({
    data: {
      accountId,
      actor: "agent",
      action,
      resource,
      metaJson: JSON.stringify(meta),
    },
  });
}

/** Управление автоответами и политикой (OpenClaw / curl с AGENT_API_TOKEN) */
r.patch("/accounts/:accountId/policy", async (req, res) => {
  const { accountId } = req.params;
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) {
    res.status(404).json({ error: "Аккаунт не найден" });
    return;
  }

  const body = req.body || {};
  const modes: ReplyMode[] = ["manual", "suggest", "auto"];
  let replyMode = body.replyMode as ReplyMode | undefined;
  if (replyMode !== undefined && !modes.includes(replyMode)) {
    res.status(400).json({ error: "replyMode: manual | suggest | auto" });
    return;
  }
  if (replyMode === "suggest" || replyMode === "auto") replyMode = "manual";

  const scopes: AgentScope[] = ["all", "allowlist"];
  const agentScope = body.agentScope as AgentScope | undefined;
  if (agentScope !== undefined && !scopes.includes(agentScope)) {
    res.status(400).json({ error: "agentScope: all | allowlist" });
    return;
  }

  const cur = { ...defaultPolicy(), ...parsePolicy(acc.policyJson) };
  const next = {
    ...cur,
    ...(typeof body.sendAllowed === "boolean" ? { sendAllowed: body.sendAllowed } : {}),
    ...(typeof body.markReadAllowed === "boolean" ? { markReadAllowed: body.markReadAllowed } : {}),
    ...(replyMode !== undefined ? { replyMode } : {}),
    ...(typeof body.autoInGroups === "boolean" ? { autoInGroups: body.autoInGroups } : {}),
    ...(agentScope !== undefined ? { agentScope } : {}),
  };

  await prisma.tgAccount.update({
    where: { id: accountId },
    data: { policyJson: JSON.stringify(next) },
  });

  await audit(accountId, "patch_policy", null, {
    replyMode: next.replyMode ?? null,
    agentScope: next.agentScope ?? null,
  });

  res.json({ ok: true, policy: next });
});

/** Список чатов, разрешённых для агента (при agentScope=allowlist). */
r.get("/accounts/:accountId/agent-allowed-dialogs", async (req, res) => {
  const { accountId } = req.params;
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) {
    res.status(404).json({ error: "Аккаунт не найден" });
    return;
  }
  const policy = { ...defaultPolicy(), ...parsePolicy(acc.policyJson) };
  const rows = await prisma.tgAgentAllowedDialog.findMany({
    where: { accountId },
    include: { dialog: true },
    orderBy: { createdAt: "asc" },
  });
  await audit(accountId, "list_agent_allowed_dialogs", null, { count: rows.length });
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

/** Заменить набор разрешённых чатов (пустой массив допустим при allowlist). */
r.put("/accounts/:accountId/agent-allowed-dialogs", async (req, res) => {
  const { accountId } = req.params;
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) {
    res.status(404).json({ error: "Аккаунт не найден" });
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
      where: { accountId, id: { in: dialogIds } },
      select: { id: true },
    });
    if (found.length !== dialogIds.length) {
      res.status(400).json({ error: "Не все dialogId принадлежат этому аккаунту" });
      return;
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.tgAgentAllowedDialog.deleteMany({ where: { accountId } });
    for (const dialogId of dialogIds) {
      await tx.tgAgentAllowedDialog.create({ data: { accountId, dialogId } });
    }
  });
  await audit(accountId, "put_agent_allowed_dialogs", null, { count: dialogIds.length });
  res.json({ ok: true, dialogIds });
});

r.get("/accounts/:accountId/dialogs", async (req, res) => {
  const { accountId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const cursor = req.query.cursor as string | undefined;

  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) {
    res.status(404).json({ error: "Аккаунт не найден" });
    return;
  }

  const allowedIds = await allowedDialogIdsOrNull(accountId);
  if (allowedIds !== null && allowedIds.length === 0) {
    await audit(accountId, "list_dialogs", null, { limit, cursor: cursor ?? null, agentFilter: "allowlist_empty" });
    res.json({ items: [], nextCursor: null, agentScope: "allowlist" });
    return;
  }

  const where =
    allowedIds === null ? { accountId } : { accountId, id: { in: allowedIds } };

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

  await audit(accountId, "list_dialogs", null, {
    limit,
    cursor: cursor ?? null,
    agentFilter: allowedIds === null ? "all" : "allowlist",
  });

  res.json({
    items: list.map((d) => ({
      id: d.id,
      peerKey: d.peerKey,
      title: d.title,
      dialogType: d.dialogType,
      unreadLocal: d.unreadLocal,
      lastSyncedAt: d.lastSyncedAt?.toISOString() ?? null,
    })),
    nextCursor,
    agentScope: allowedIds === null ? "all" : "allowlist",
  });
});

r.get("/dialogs/:dialogId/messages", async (req, res) => {
  const { dialogId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = req.query.beforeId as string | undefined;

  const dialog = await prisma.tgDialog.findUnique({
    where: { id: dialogId },
    include: { account: true },
  });
  if (!dialog) {
    res.status(404).json({ error: "Диалог не найден" });
    return;
  }

  if (!(await isDialogAllowedForAgent(dialog.accountId, dialogId))) {
    res.status(403).json({ error: "Диалог не разрешён для агента (agentScope / allowlist)" });
    return;
  }

  const where: { dialogId: string; id?: { lt: string } } = { dialogId };
  if (beforeId) {
    where.id = { lt: beforeId };
  }

  const msgs = await prisma.tgMessage.findMany({
    where,
    orderBy: { date: "desc" },
    take: limit,
  });

  await audit(dialog.accountId, "get_messages", dialogId, { limit, beforeId: beforeId ?? null });

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
  const { allowUnconfirmedHttpOutbound } = await import("../lib/outboundPolicy.js");
  if (!allowUnconfirmedHttpOutbound()) {
    res.status(403).json({
      error: "outbound_requires_bot_confirm",
      message:
        "Прямая постановка в очередь отправки отключена: подтвердите исходящее в продуктовом боте. Для отладки: ALLOW_UNCONFIRMED_HTTP_OUTBOUND=1.",
    });
    return;
  }
  const { dialogId } = req.params;
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 4096) {
    res.status(400).json({ error: "text 1..4096" });
    return;
  }

  const dialog = await prisma.tgDialog.findUnique({
    where: { id: dialogId },
    include: { account: true },
  });
  if (!dialog) {
    res.status(404).json({ error: "Диалог не найден" });
    return;
  }

  if (!(await isDialogAllowedForAgent(dialog.accountId, dialogId))) {
    res.status(403).json({ error: "Диалог не разрешён для агента (agentScope / allowlist)" });
    return;
  }

  const policy = { ...defaultPolicy(), ...parsePolicy(dialog.account.policyJson) };
  if (!policy.sendAllowed) {
    res.status(403).json({ error: "Отправка запрещена policyJson" });
    return;
  }

  const job = await prisma.tgPendingSend.create({
    data: {
      accountId: dialog.accountId,
      peerKey: dialog.peerKey,
      text,
      status: "pending",
    },
  });

  await audit(dialog.accountId, "queue_send", dialogId, { pendingId: job.id, len: text.length });

  res.status(202).json({ queued: true, tgMessageId: null, pendingId: job.id });
});

r.post("/dialogs/:dialogId/read", async (req, res) => {
  const { dialogId } = req.params;
  const upTo = req.body?.upToTgMessageId;

  const dialog = await prisma.tgDialog.findUnique({
    where: { id: dialogId },
    include: { account: true },
  });
  if (!dialog) {
    res.status(404).json({ error: "Диалог не найден" });
    return;
  }

  if (!(await isDialogAllowedForAgent(dialog.accountId, dialogId))) {
    res.status(403).json({ error: "Диалог не разрешён для агента (agentScope / allowlist)" });
    return;
  }

  const policy = { ...defaultPolicy(), ...parsePolicy(dialog.account.policyJson) };
  if (!policy.markReadAllowed) {
    res.status(403).json({ error: "mark_read запрещён policyJson" });
    return;
  }

  await prisma.tgDialog.update({
    where: { id: dialogId },
    data: { unreadLocal: 0 },
  });

  await syncStateExtra(dialog.accountId, { lastMarkRead: { dialogId, upToTgMessageId: upTo } });

  await audit(dialog.accountId, "mark_read_local", dialogId, { upToTgMessageId: upTo ?? null });

  res.status(204).send();
});

async function syncStateExtra(accountId: string, patch: object) {
  const s = await prisma.tgSyncState.findUnique({ where: { accountId } });
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(s?.extraJson || "{}") as Record<string, unknown>;
  } catch {
    extra = {};
  }
  Object.assign(extra, patch);
  await prisma.tgSyncState.upsert({
    where: { accountId },
    create: { accountId, extraJson: JSON.stringify(extra) },
    update: { extraJson: JSON.stringify(extra) },
  });
}

export default r;
