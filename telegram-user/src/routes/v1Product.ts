import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAgentToken } from "../middleware/agentAuth.js";
import {
  createProductAgent,
  updateProductAgent,
  deleteProductAgent,
  setDialogAgent,
  clearDialogAgent,
  MAX_PRODUCT_AGENTS,
} from "../lib/productAgents.js";

const r = Router();
r.use(requireAgentToken);

async function auditForAppUser(appUserId: string, action: string, resource: string | null, meta: object) {
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
  if (!acc) return;
  await prisma.tgAgentAuditLog.create({
    data: {
      accountId: acc.id,
      actor: "agent",
      action,
      resource,
      metaJson: JSON.stringify(meta),
    },
  });
}

/** Задачи: общий список по appUserId */
r.get("/app-users/:appUserId/tasks", async (req, res) => {
  const { appUserId } = req.params;
  const status = req.query.status as string | undefined;
  const where: { appUserId: string; status?: "open" | "done" } = { appUserId };
  if (status === "open" || status === "done") {
    where.status = status;
  }
  const items = await prisma.task.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });
  await auditForAppUser(appUserId, "list_tasks", null, { count: items.length });
  res.json({
    items: items.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
});

r.post("/app-users/:appUserId/tasks", async (req, res) => {
  const { appUserId } = req.params;
  const title = String(req.body?.title || "").trim();
  if (!title || title.length > 500) {
    res.status(400).json({ error: "title 1..500" });
    return;
  }
  const body = req.body?.body != null ? String(req.body.body).slice(0, 8000) : null;
  const dueRaw = req.body?.dueAt;
  let dueAt: Date | null = null;
  if (dueRaw) {
    const d = new Date(String(dueRaw));
    if (!Number.isNaN(d.getTime())) dueAt = d;
  }
  const t = await prisma.task.create({
    data: {
      appUserId,
      title,
      body,
      dueAt,
      status: "open",
    },
  });
  await auditForAppUser(appUserId, "create_task", t.id, { title: title.slice(0, 80) });
  res.status(201).json({
    id: t.id,
    title: t.title,
    body: t.body,
    status: t.status,
    dueAt: t.dueAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  });
});

r.patch("/app-users/:appUserId/tasks/:taskId", async (req, res) => {
  const { appUserId, taskId } = req.params;
  const t = await prisma.task.findFirst({ where: { id: taskId, appUserId } });
  if (!t) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }
  const status = req.body?.status;
  const title = req.body?.title != null ? String(req.body.title).trim() : undefined;
  const body = req.body?.body !== undefined ? (req.body.body == null ? null : String(req.body.body).slice(0, 8000)) : undefined;
  const data: {
    status?: "open" | "done";
    title?: string;
    body?: string | null;
    dueAt?: Date | null;
  } = {};
  if (status === "open" || status === "done") data.status = status;
  if (title !== undefined) {
    if (!title || title.length > 500) {
      res.status(400).json({ error: "title 1..500" });
      return;
    }
    data.title = title;
  }
  if (body !== undefined) data.body = body;
  if (req.body?.dueAt !== undefined) {
    const raw = req.body.dueAt;
    data.dueAt = raw == null || raw === "" ? null : new Date(String(raw));
    if (data.dueAt && Number.isNaN(data.dueAt.getTime())) {
      res.status(400).json({ error: "dueAt невалидная дата" });
      return;
    }
  }
  const updated = await prisma.task.update({
    where: { id: taskId },
    data,
  });
  await auditForAppUser(appUserId, "update_task", taskId, { fields: Object.keys(data) });
  res.json({
    id: updated.id,
    title: updated.title,
    body: updated.body,
    status: updated.status,
    dueAt: updated.dueAt?.toISOString() ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  });
});

r.delete("/app-users/:appUserId/tasks/:taskId", async (req, res) => {
  const { appUserId, taskId } = req.params;
  const t = await prisma.task.findFirst({ where: { id: taskId, appUserId } });
  if (!t) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }
  await prisma.task.delete({ where: { id: taskId } });
  await auditForAppUser(appUserId, "delete_task", taskId, {});
  res.status(204).send();
});

/** Напоминания */
r.get("/app-users/:appUserId/reminders", async (req, res) => {
  const { appUserId } = req.params;
  const status = req.query.status as string | undefined;
  const allowed: Array<
    "pending" | "sent" | "cancelled" | "awaiting_confirm" | "completed"
  > = ["pending", "sent", "cancelled", "awaiting_confirm", "completed"];
  const where: {
    appUserId: string;
    status?: (typeof allowed)[number];
  } = { appUserId };
  if (status && allowed.includes(status as (typeof allowed)[number])) {
    where.status = status as (typeof allowed)[number];
  }
  const items = await prisma.reminder.findMany({
    where,
    orderBy: [{ fireAt: "asc" }],
    take: 200,
  });
  await auditForAppUser(appUserId, "list_reminders", null, { count: items.length });
  res.json({
    items: items.map((m) => ({
      id: m.id,
      accountId: m.accountId,
      title: m.title,
      text: m.text,
      fireAt: m.fireAt.toISOString(),
      notifyTelegram: m.notifyTelegram,
      notifyWeb: m.notifyWeb,
      status: m.status,
      requiresBotAck: m.requiresBotAck,
      telegramSentAt: m.telegramSentAt?.toISOString() ?? null,
      webSentAt: m.webSentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

r.post("/app-users/:appUserId/reminders", async (req, res) => {
  const { appUserId } = req.params;
  const title = String(req.body?.title || "").trim();
  const text = String(req.body?.text || "").trim();
  if (!title || title.length > 300 || !text || text.length > 4000) {
    res.status(400).json({ error: "title 1..300, text 1..4000" });
    return;
  }
  const fireRaw = req.body?.fireAt;
  if (!fireRaw) {
    res.status(400).json({ error: "fireAt обязателен (ISO)" });
    return;
  }
  const fireAt = new Date(String(fireRaw));
  if (Number.isNaN(fireAt.getTime())) {
    res.status(400).json({ error: "fireAt невалидная дата" });
    return;
  }
  const notifyTelegram = Boolean(req.body?.notifyTelegram ?? true);
  const notifyWeb = Boolean(req.body?.notifyWeb ?? true);
  let accountId: string | null = req.body?.accountId != null ? String(req.body.accountId) : null;
  if (notifyTelegram) {
    if (!accountId) {
      const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
      accountId = acc?.id ?? null;
    }
    if (!accountId) {
      res.status(400).json({ error: "Нет TgAccount для appUserId — укажите accountId или подключите Telegram" });
      return;
    }
    const acc = await prisma.tgAccount.findFirst({ where: { id: accountId, appUserId } });
    if (!acc) {
      res.status(400).json({ error: "accountId не принадлежит appUserId" });
      return;
    }
  } else {
    accountId = null;
  }

  const m = await prisma.reminder.create({
    data: {
      appUserId,
      accountId,
      title,
      text,
      fireAt,
      notifyTelegram,
      notifyWeb,
      status: "pending",
    },
  });
  await auditForAppUser(appUserId, "create_reminder", m.id, { fireAt: m.fireAt.toISOString() });
  res.status(201).json({
    id: m.id,
    accountId: m.accountId,
    title: m.title,
    text: m.text,
    fireAt: m.fireAt.toISOString(),
    notifyTelegram: m.notifyTelegram,
    notifyWeb: m.notifyWeb,
    status: m.status,
  });
});

r.patch("/app-users/:appUserId/reminders/:reminderId", async (req, res) => {
  const { appUserId, reminderId } = req.params;
  const m = await prisma.reminder.findFirst({ where: { id: reminderId, appUserId } });
  if (!m) {
    res.status(404).json({ error: "Напоминание не найдено" });
    return;
  }
  if (
    req.body?.status === "cancelled" &&
    (m.status === "pending" || m.status === "awaiting_confirm")
  ) {
    await prisma.reminder.update({
      where: { id: reminderId },
      data: { status: "cancelled" },
    });
    await auditForAppUser(appUserId, "cancel_reminder", reminderId, {});
    res.json({ ok: true, status: "cancelled" });
    return;
  }
  res.status(400).json({ error: "Допустимо только status=cancelled для pending или awaiting_confirm" });
});

/** Веб-инбокс: недавно сработавшие с notifyWeb */
r.get("/app-users/:appUserId/reminders/web-inbox", async (req, res) => {
  const { appUserId } = req.params;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const items = await prisma.reminder.findMany({
    where: {
      appUserId,
      notifyWeb: true,
      webSentAt: { gte: since },
    },
    orderBy: { webSentAt: "desc" },
    take: 50,
  });
  res.json({
    items: items.map((m) => ({
      id: m.id,
      title: m.title,
      text: m.text,
      fireAt: m.fireAt.toISOString(),
      webSentAt: m.webSentAt?.toISOString() ?? null,
    })),
  });
});

/** ProductAgent (до MAX_PRODUCT_AGENTS) */
r.get("/app-users/:appUserId/product-agents", async (req, res) => {
  const { appUserId } = req.params;
  const items = await prisma.productAgent.findMany({
    where: { appUserId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { dialogs: { select: { dialogId: true } } },
  });
  await auditForAppUser(appUserId, "list_product_agents", null, { count: items.length });
  res.json({
    max: MAX_PRODUCT_AGENTS,
    items: items.map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      isDefault: a.isDefault,
      planJson: a.planJson,
      promptExtras: a.promptExtras,
      dialogIds: a.dialogs.map((d) => d.dialogId),
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

r.post("/app-users/:appUserId/product-agents", async (req, res) => {
  const { appUserId } = req.params;
  try {
    const a = await createProductAgent(appUserId, {
      name: String(req.body?.name || ""),
      promptExtras: req.body?.promptExtras != null ? String(req.body.promptExtras) : undefined,
      planJson: req.body?.planJson != null ? String(req.body.planJson) : undefined,
      isDefault: Boolean(req.body?.isDefault),
    });
    await auditForAppUser(appUserId, "create_product_agent", a.id, { name: a.name });
    res.status(201).json({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      isDefault: a.isDefault,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

r.patch("/app-users/:appUserId/product-agents/:agentId", async (req, res) => {
  const { appUserId, agentId } = req.params;
  try {
    const a = await updateProductAgent(appUserId, agentId, {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
      promptExtras: req.body?.promptExtras != null ? String(req.body.promptExtras) : undefined,
      planJson: req.body?.planJson != null ? String(req.body.planJson) : undefined,
      isDefault: typeof req.body?.isDefault === "boolean" ? req.body.isDefault : undefined,
      sortOrder: typeof req.body?.sortOrder === "number" ? req.body.sortOrder : undefined,
    });
    await auditForAppUser(appUserId, "update_product_agent", agentId, {});
    res.json({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      isDefault: a.isDefault,
      updatedAt: a.updatedAt.toISOString(),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

r.delete("/app-users/:appUserId/product-agents/:agentId", async (req, res) => {
  const { appUserId, agentId } = req.params;
  try {
    await deleteProductAgent(appUserId, agentId);
    await auditForAppUser(appUserId, "delete_product_agent", agentId, {});
    res.status(204).send();
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

r.post("/app-users/:appUserId/product-agents/:agentId/dialogs", async (req, res) => {
  const { appUserId, agentId } = req.params;
  const dialogId = String(req.body?.dialogId || "").trim();
  if (!dialogId) {
    res.status(400).json({ error: "dialogId обязателен" });
    return;
  }
  try {
    await setDialogAgent(appUserId, agentId, dialogId);
    await auditForAppUser(appUserId, "product_agent_set_dialog", agentId, { dialogId });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

r.delete("/app-users/:appUserId/product-agents/dialogs/:dialogId", async (req, res) => {
  const { appUserId, dialogId } = req.params;
  try {
    await clearDialogAgent(appUserId, dialogId);
    await auditForAppUser(appUserId, "product_agent_clear_dialog", dialogId, {});
    res.status(204).send();
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "error" });
  }
});

/** Заметки UserNote */
r.get("/app-users/:appUserId/user-notes", async (req, res) => {
  const { appUserId } = req.params;
  const items = await prisma.userNote.findMany({
    where: { appUserId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  await auditForAppUser(appUserId, "list_user_notes", null, { count: items.length });
  res.json({
    items: items.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

r.post("/app-users/:appUserId/user-notes", async (req, res) => {
  const { appUserId } = req.params;
  const body = String(req.body?.body || "").trim();
  if (!body || body.length > 8000) {
    res.status(400).json({ error: "body 1..8000" });
    return;
  }
  const n = await prisma.userNote.create({ data: { appUserId, body } });
  await auditForAppUser(appUserId, "create_user_note", n.id, {});
  res.status(201).json({ id: n.id, createdAt: n.createdAt.toISOString() });
});

r.delete("/app-users/:appUserId/user-notes/:noteId", async (req, res) => {
  const { appUserId, noteId } = req.params;
  const n = await prisma.userNote.findFirst({ where: { id: noteId, appUserId } });
  if (!n) {
    res.status(404).json({ error: "not found" });
    return;
  }
  await prisma.userNote.delete({ where: { id: noteId } });
  await auditForAppUser(appUserId, "delete_user_note", noteId, {});
  res.status(204).send();
});

/** Подписки на новости */
r.get("/app-users/:appUserId/news-subscriptions", async (req, res) => {
  const { appUserId } = req.params;
  const items = await prisma.newsSubscription.findMany({
    where: { appUserId },
    orderBy: { createdAt: "desc" },
  });
  await auditForAppUser(appUserId, "list_news_subscriptions", null, { count: items.length });
  res.json({
    items: items.map((s) => ({
      id: s.id,
      sourceKind: s.sourceKind,
      sourceId: s.sourceId,
      title: s.title,
      enabled: s.enabled,
      lastDigestAt: s.lastDigestAt?.toISOString() ?? null,
    })),
  });
});

r.post("/app-users/:appUserId/news-subscriptions", async (req, res) => {
  const { appUserId } = req.params;
  const sourceKind = String(req.body?.sourceKind || "").trim();
  const sourceId = String(req.body?.sourceId || "").trim();
  if (sourceKind !== "mtproto_dialog" && sourceKind !== "bot_chat") {
    res.status(400).json({ error: "sourceKind: mtproto_dialog | bot_chat" });
    return;
  }
  if (!sourceId) {
    res.status(400).json({ error: "sourceId обязателен" });
    return;
  }
  const title = req.body?.title != null ? String(req.body.title).slice(0, 200) : null;
  const s = await prisma.newsSubscription.upsert({
    where: {
      appUserId_sourceKind_sourceId: { appUserId, sourceKind, sourceId },
    },
    create: {
      appUserId,
      sourceKind,
      sourceId,
      title,
      enabled: true,
    },
    update: { title, enabled: true },
  });
  await auditForAppUser(appUserId, "upsert_news_subscription", s.id, { sourceKind, sourceId });
  res.status(201).json({
    id: s.id,
    sourceKind: s.sourceKind,
    sourceId: s.sourceId,
    enabled: s.enabled,
  });
});

r.patch("/app-users/:appUserId/news-subscriptions/:subId", async (req, res) => {
  const { appUserId, subId } = req.params;
  const s = await prisma.newsSubscription.findFirst({ where: { id: subId, appUserId } });
  if (!s) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;
  const title = req.body?.title != null ? String(req.body.title).slice(0, 200) : undefined;
  const updated = await prisma.newsSubscription.update({
    where: { id: subId },
    data: {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(title !== undefined ? { title } : {}),
    },
  });
  await auditForAppUser(appUserId, "update_news_subscription", subId, {});
  res.json({ id: updated.id, enabled: updated.enabled, title: updated.title });
});

r.delete("/app-users/:appUserId/news-subscriptions/:subId", async (req, res) => {
  const { appUserId, subId } = req.params;
  const s = await prisma.newsSubscription.findFirst({ where: { id: subId, appUserId } });
  if (!s) {
    res.status(404).json({ error: "not found" });
    return;
  }
  await prisma.newsSubscription.delete({ where: { id: subId } });
  await auditForAppUser(appUserId, "delete_news_subscription", subId, {});
  res.status(204).send();
});

export default r;
