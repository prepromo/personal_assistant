import { prisma } from "./prisma.js";
import { parsePolicy, defaultPolicy, effectiveReplyModeForDialog } from "./policy.js";
import { isDialogAllowedForAgent } from "./agentDialogAccess.js";

const SKIP_LOG = process.env.AUTOMATION_SKIP_LOG === "1" || process.env.AUTOMATION_SKIP_LOG === "true";

function logSkip(reason: string, detail?: Record<string, unknown>): void {
  if (!SKIP_LOG) return;
  const d = detail ? ` ${JSON.stringify(detail)}` : "";
  console.info(`[automation] skip: ${reason}${d}`);
}

export type InboundAutomationEval =
  | { ok: true; kind: "suggest" | "auto" }
  | { ok: false; reason: string };

/**
 * Одна точка правды: можно ли поставить job и какой kind.
 */
export async function evaluateInboundAutomation(params: {
  accountId: string;
  dialogId: string;
  outgoing: boolean;
}): Promise<InboundAutomationEval> {
  if (params.outgoing) return { ok: false, reason: "исходящее сообщение" };

  const acc = await prisma.tgAccount.findUnique({ where: { id: params.accountId } });
  if (!acc) return { ok: false, reason: "нет TgAccount" };

  const policy = { ...defaultPolicy(), ...parsePolicy(acc.policyJson) };
  const mode = effectiveReplyModeForDialog(policy, params.dialogId);
  if (mode === "manual") {
    return {
      ok: false,
      reason:
        "replyMode=manual для этого чата или глобально (кабинет / бот → Политика или Режим чатов)",
    };
  }

  const dialog = await prisma.tgDialog.findUnique({ where: { id: params.dialogId } });
  if (!dialog) return { ok: false, reason: "диалог не найден" };

  const agentOk = await isDialogAllowedForAgent(params.accountId, params.dialogId);
  if (!agentOk) {
    return {
      ok: false,
      reason:
        "agentScope=allowlist, но диалог не в списке (кабинет → «Сохранить список для агента»)",
    };
  }

  const allowNonPrivate = policy.autoInGroups === true;
  if (dialog.dialogType !== "user" && !allowNonPrivate) {
    return {
      ok: false,
      reason:
        "не личка и autoInGroups=false (включите автоответы в группах или пишите в личку)",
    };
  }

  const kind = mode === "suggest" ? "suggest" : "auto";
  return { ok: true, kind };
}

/**
 * Для GET /internal/automation-debug — текст причины без дублирования логики.
 */
export async function explainInboundAutomationSkip(params: {
  accountId: string;
  dialogId: string;
  outgoing: boolean;
}): Promise<string | null> {
  const ev = await evaluateInboundAutomation(params);
  return ev.ok ? null : ev.reason;
}

