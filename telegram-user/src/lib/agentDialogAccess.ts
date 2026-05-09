import { prisma } from "./prisma.js";
import { parsePolicy, defaultPolicy, type AgentScope } from "./policy.js";

export function normalizedAgentScope(policyJson: string): AgentScope {
  const p = { ...defaultPolicy(), ...parsePolicy(policyJson) };
  return p.agentScope === "allowlist" ? "allowlist" : "all";
}

/** Агентский API: при allowlist — только строки в TgAgentAllowedDialog. */
export async function isDialogAllowedForAgent(accountId: string, dialogId: string): Promise<boolean> {
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) return false;
  if (normalizedAgentScope(acc.policyJson) === "all") return true;
  const row = await prisma.tgAgentAllowedDialog.findUnique({
    where: { accountId_dialogId: { accountId, dialogId } },
  });
  return !!row;
}

/** Для фильтрации списка диалогов в agent API: null = без фильтра (все чаты). */
export async function allowedDialogIdsOrNull(accountId: string): Promise<string[] | null> {
  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) return null;
  if (normalizedAgentScope(acc.policyJson) === "all") return null;
  const rows = await prisma.tgAgentAllowedDialog.findMany({
    where: { accountId },
    select: { dialogId: true },
  });
  return rows.map((r) => r.dialogId);
}
