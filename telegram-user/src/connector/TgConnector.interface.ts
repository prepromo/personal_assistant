/**
 * Контракт MTProto-коннектора (реализация — Python Telethon/Pyrogram или TDLib sidecar).
 * Здесь только типы; без реальной сети.
 */

export type PeerKey = string;

export interface ConnectorAuthStart {
  phoneE164: string;
}

export interface ConnectorAuthCode {
  phoneE164: string;
  code: string;
  password?: string;
}

export interface ConnectorUpdateEnvelope {
  accountId: string;
  kind: "new_message" | "edit" | "delete" | "read" | "unknown";
  peerKey: PeerKey;
  payloadJson: string;
}

/** Публикует обновления во внутреннюю очередь / HTTP воркер */
export interface TgConnector {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** После успешной авторизации — непрерывный цикл sync */
  connectWithSession(accountId: string, sessionDecrypted: Buffer): Promise<void>;
  sendMessage(accountId: string, peerKey: PeerKey, text: string): Promise<{ tgMessageId: number }>;
  markRead(accountId: string, peerKey: PeerKey, upToTgMessageId: number): Promise<void>;
}
