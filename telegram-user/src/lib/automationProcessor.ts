/**
 * Inbound MTProto auto-replies (LLM → Telegram on every message) were removed from the product.
 * This module remains as a small stub so imports stay stable.
 */
export async function processAutomationJobsOnce(): Promise<void> {}

/** @deprecated Kept for scripts/test-automation-prompt.ts only. */
export function getAutomationSystemContent(): string {
  return "Автоответы по входящим сообщениям в этой сборке отключены.";
}

/** @deprecated Kept for scripts/test-automation-prompt.ts only. */
export function getAutomationLlmOptionsForTests(): { maxTokens: number; temperature: number } {
  return { maxTokens: 256, temperature: 0.4 };
}
