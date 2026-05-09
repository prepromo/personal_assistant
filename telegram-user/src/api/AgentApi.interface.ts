/**
 * Сторона API gateway: вызовы, которые позже повесятся на Express/Fastify.
 * Агент OpenClaw использует только HTTP-эквивалент этих методов.
 */

export interface DialogListItem {
  id: string;
  peerKey: string;
  title: string | null;
  dialogType: "user" | "group" | "supergroup" | "channel";
  unreadLocal: number;
  lastSyncedAt: string | null;
}

export interface MessageItem {
  id: string;
  tgMessageId: number;
  date: string;
  text: string | null;
  out: boolean;
}

export interface AgentApi {
  listDialogs(
    accountId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: DialogListItem[]; nextCursor: string | null }>;

  getMessages(
    dialogId: string,
    opts: { beforeId?: string; limit?: number },
  ): Promise<{ items: MessageItem[] }>;

  sendMessage(dialogId: string, text: string): Promise<{ queued: boolean; tgMessageId: number | null }>;

  markRead(dialogId: string, upToTgMessageId: number): Promise<void>;
}
