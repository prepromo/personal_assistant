/** policyJson в TgAccount: send/mark_read + replyMode для автоматизации */

export type ReplyMode = "manual" | "suggest" | "auto";

export type AgentScope = "all" | "allowlist";

/** Переопределение режима для конкретного TgDialog (UUID). Если replyMode задан — подменяет глобальный policy.replyMode для этого диалога. */
export type DialogPolicyOverride = {
  replyMode?: ReplyMode;
};

export type Policy = {
  sendAllowed?: boolean;
  markReadAllowed?: boolean;
  /** Только manual: suggest/auto в JSON игнорируются (см. parsePolicy). */
  replyMode?: ReplyMode;
  /** По dialogId (UUID): локальный режим автоответа для чата */
  dialogOverrides?: Record<string, DialogPolicyOverride>;
  /**
   * true — авто/suggest и в группах/каналах (нужны права на отправку; иначе 400 CHAT_ADMIN_REQUIRED).
   * false (по умолчанию) — только личка (dialogType user).
   */
  autoInGroups?: boolean;
  /**
   * all — агентский API ко всем диалогам аккаунта (как раньше).
   * allowlist — только чаты из таблицы TgAgentAllowedDialog.
   */
  agentScope?: AgentScope;
};

export function parsePolicy(json: string): Policy {
  try {
    const raw = JSON.parse(json || "{}") as Policy;
    const p: Policy = { ...raw };
    if (p.replyMode === "suggest" || p.replyMode === "auto") {
      p.replyMode = "manual";
    }
    if (p.dialogOverrides && typeof p.dialogOverrides === "object") {
      const nextOverrides: Record<string, DialogPolicyOverride> = { ...p.dialogOverrides };
      for (const id of Object.keys(nextOverrides)) {
        const o = nextOverrides[id];
        if (o?.replyMode === "suggest" || o?.replyMode === "auto") {
          delete nextOverrides[id];
        }
      }
      p.dialogOverrides = Object.keys(nextOverrides).length ? nextOverrides : undefined;
    }
    return p;
  } catch {
    return {};
  }
}

export function defaultPolicy(): Policy {
  return {
    // Safe-by-default: never send anything automatically until user explicitly enables.
    sendAllowed: false,
    markReadAllowed: true,
    replyMode: "manual",
    autoInGroups: false,
    agentScope: "allowlist",
  };
}

/** Эффективный режим автоответа с учётом dialogOverrides[dialogId]. */
export function effectiveReplyModeForDialog(policy: Policy, dialogId: string): ReplyMode {
  const base = policy.replyMode ?? "manual";
  const o = policy.dialogOverrides?.[dialogId]?.replyMode;
  return o ?? base;
}
