import { prisma } from "./prisma.js";
import {
  parsePolicy,
  defaultPolicy,
  type ReplyMode,
  type AgentScope,
  type Policy,
  type DialogPolicyOverride,
} from "./policy.js";

async function audit(accountId: string, action: string, resource: string | null, meta: object) {
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

export async function getAccountForTelegramUser(
  telegramUserId: number,
): Promise<{ appUserId: string; accountId: string } | null> {
  const tid = String(telegramUserId);
  const b = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!b) return null;
  const acc = await prisma.tgAccount.findUnique({ where: { appUserId: b.appUserId } });
  if (!acc) return null;
  return { appUserId: b.appUserId, accountId: acc.id };
}

export function formatPolicyLines(policy: Policy): string {
  const p = { ...defaultPolicy(), ...policy };
  const scope = (p.agentScope ?? "all") === "allowlist" ? "только список ниже" : "все личные диалоги";
  const groups = p.autoInGroups ? "да" : "нет (только личка)";
  return [
    "Автоответы LLM по входящим в личный Telegram **отключены**; переключателей **manual / suggest / auto** в продукте нет.",
    `Область агента (API / список): ${scope}`,
    `Учёт групп/каналов в политике: ${groups}`,
  ].join("\n");
}

export async function patchPolicyFromBot(
  accountId: string,
  patch: {
    replyMode?: ReplyMode;
    agentScope?: AgentScope;
    autoInGroups?: boolean;
  },
): Promise<Policy> {
  const tg = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!tg) throw new Error("TgAccount не найден");
  const cur = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  const modes: ReplyMode[] = ["manual", "suggest", "auto"];
  if (patch.replyMode !== undefined && !modes.includes(patch.replyMode)) {
    throw new Error("replyMode");
  }
  const scopes: AgentScope[] = ["all", "allowlist"];
  if (patch.agentScope !== undefined && !scopes.includes(patch.agentScope)) {
    throw new Error("agentScope");
  }
  const replyStored =
    patch.replyMode !== undefined
      ? patch.replyMode === "suggest" || patch.replyMode === "auto"
        ? ("manual" as ReplyMode)
        : patch.replyMode
      : undefined;
  const next: Policy = {
    ...cur,
    ...(replyStored !== undefined ? { replyMode: replyStored } : {}),
    ...(patch.agentScope !== undefined ? { agentScope: patch.agentScope } : {}),
    ...(typeof patch.autoInGroups === "boolean" ? { autoInGroups: patch.autoInGroups } : {}),
  };
  await prisma.tgAccount.update({
    where: { id: accountId },
    data: { policyJson: JSON.stringify(next) },
  });
  await audit(accountId, "policy_update_telegram_bot", null, { keys: Object.keys(patch) });
  return next;
}

/** Режим автоответа для одного диалога (переопределяет глобальный replyMode). Пустой override — сброс на глобальный. */
export async function patchDialogReplyModeFromBot(
  accountId: string,
  dialogId: string,
  replyMode: ReplyMode | null,
): Promise<Policy> {
  const tg = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!tg) throw new Error("TgAccount не найден");
  const dlg = await prisma.tgDialog.findFirst({ where: { id: dialogId, accountId } });
  if (!dlg) throw new Error("Диалог не найден для этого аккаунта");

  const cur = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  const modes: ReplyMode[] = ["manual", "suggest", "auto"];
  if (replyMode !== null && !modes.includes(replyMode)) {
    throw new Error("replyMode");
  }
  const effectiveMode =
    replyMode === null
      ? null
      : replyMode === "suggest" || replyMode === "auto"
        ? null
        : replyMode;
  const overrides: Record<string, DialogPolicyOverride> = { ...(cur.dialogOverrides ?? {}) };
  if (effectiveMode === null) {
    delete overrides[dialogId];
  } else {
    overrides[dialogId] = { replyMode: effectiveMode };
  }
  const next: Policy = {
    ...cur,
    dialogOverrides: Object.keys(overrides).length ? overrides : undefined,
  };
  await prisma.tgAccount.update({
    where: { id: accountId },
    data: { policyJson: JSON.stringify(next) },
  });
  await audit(accountId, "policy_dialog_override_telegram_bot", dialogId, {
    replyMode: replyMode ?? "reset",
  });
  return next;
}

/** При добавлении чата в «Мои чаты»: если включён allowlist — добавить диалог в список агента. */
export async function maybeAddDialogToAgentAllowlist(accountId: string, dialogId: string): Promise<void> {
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) return;
  const policy = { ...defaultPolicy(), ...parsePolicy(acc.policyJson) };
  if (policy.agentScope !== "allowlist") return;
  await prisma.tgAgentAllowedDialog.upsert({
    where: { accountId_dialogId: { accountId, dialogId } },
    create: { accountId, dialogId },
    update: {},
  });
  await audit(accountId, "bot_allowlist_add", dialogId, {});
}

/** Добавить в allowlist по peerKey (ручной id чата), если диалог есть в MTProto. */
export async function maybeAddPeerToAgentAllowlist(accountId: string, peerKey: string): Promise<boolean> {
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) return false;
  const policy = { ...defaultPolicy(), ...parsePolicy(acc.policyJson) };
  if (policy.agentScope !== "allowlist") return false;
  const dlg = await prisma.tgDialog.findFirst({ where: { accountId, peerKey } });
  if (!dlg) return false;
  await prisma.tgAgentAllowedDialog.upsert({
    where: { accountId_dialogId: { accountId, dialogId: dlg.id } },
    create: { accountId, dialogId: dlg.id },
    update: {},
  });
  await audit(accountId, "bot_allowlist_add_peer", dlg.id, { peerKey });
  return true;
}

/** Убрать чат из «Мои чаты» и снять с allowlist агента, если был связанный TgDialog. */
export async function removeBotConnectedChat(
  appUserId: string,
  accountId: string | null,
  telegramChatId: string,
): Promise<boolean> {
  const del = await prisma.botConnectedChat.deleteMany({
    where: { appUserId, telegramChatId },
  });
  if (del.count === 0) return false;
  if (accountId) {
    const dlg = await prisma.tgDialog.findFirst({
      where: { accountId, peerKey: telegramChatId },
    });
    if (dlg) {
      await prisma.tgAgentAllowedDialog.deleteMany({
        where: { accountId, dialogId: dlg.id },
      });
      await audit(accountId, "bot_connected_chat_removed", dlg.id, { telegramChatId });
    } else {
      await audit(accountId, "bot_connected_chat_removed", null, { telegramChatId });
    }
  }
  return true;
}

export async function seedAllowlistFromBotConnectedChats(
  accountId: string,
  appUserId: string,
): Promise<number> {
  const connected = await prisma.botConnectedChat.findMany({ where: { appUserId } });
  let n = 0;
  for (const c of connected) {
    const dlg = await prisma.tgDialog.findFirst({
      where: { accountId, peerKey: c.telegramChatId },
    });
    if (!dlg) continue;
    await prisma.tgAgentAllowedDialog.upsert({
      where: { accountId_dialogId: { accountId, dialogId: dlg.id } },
      create: { accountId, dialogId: dlg.id },
      update: {},
    });
    n++;
  }
  if (n > 0) {
    await audit(accountId, "bot_allowlist_seed_from_connected", null, { count: n });
  }
  return n;
}

export async function toggleAgentAllowedDialog(
  accountId: string,
  dialogId: string,
  allow: boolean,
): Promise<void> {
  const dlg = await prisma.tgDialog.findFirst({ where: { id: dialogId, accountId } });
  if (!dlg) throw new Error("dialog_not_found");
  if (allow) {
    await prisma.tgAgentAllowedDialog.upsert({
      where: { accountId_dialogId: { accountId, dialogId } },
      create: { accountId, dialogId },
      update: {},
    });
    await audit(accountId, "bot_allowlist_toggle_on", dialogId, {});
  } else {
    await prisma.tgAgentAllowedDialog.deleteMany({ where: { accountId, dialogId } });
    await audit(accountId, "bot_allowlist_toggle_off", dialogId, {});
  }
}

const PAGE = 8;

export async function listDialogsPage(
  accountId: string,
  page: number,
): Promise<{ dialogs: { id: string; title: string | null; peerKey: string; dialogType: string }[]; total: number }> {
  const total = await prisma.tgDialog.count({ where: { accountId } });
  const dialogs = await prisma.tgDialog.findMany({
    where: { accountId },
    orderBy: { updatedAt: "desc" },
    skip: page * PAGE,
    take: PAGE,
    select: { id: true, title: true, peerKey: true, dialogType: true },
  });
  return { dialogs, total };
}

export async function getAllowedDialogIdSet(accountId: string): Promise<Set<string>> {
  const rows = await prisma.tgAgentAllowedDialog.findMany({
    where: { accountId },
    select: { dialogId: true },
  });
  return new Set(rows.map((r) => r.dialogId));
}

export { PAGE as AGENT_DIALOG_PAGE_SIZE };
