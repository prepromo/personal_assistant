import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { decryptJson } from "./encryption.service.js";
import { isOpenClawConfigured, openClawChatCompletion } from "./openclaw.service.js";

const running = new Set();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tgApi(botToken, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    logger.warn(`telegram ${method}`, { description: data.description });
  }
  return data;
}

/** Long polling требует сброса webhook */
async function deleteWebhook(botToken) {
  await tgApi(botToken, "deleteWebhook", { drop_pending_updates: false });
}

/**
 * Запуск long-polling для канала (локальная разработка без HTTPS).
 * Для прод с публичным URL лучше webhook + setWebhook.
 */
export function ensureTelegramPoll(channelId) {
  if (running.has(channelId)) return;
  running.add(channelId);
  runLoop(channelId).catch((e) => {
    logger.error(`telegram poll crashed ${channelId}`, e);
    running.delete(channelId);
  });
}

export async function bootstrapTelegramIngest() {
  const channels = await prisma.channel.findMany({
    where: { type: "telegram", status: "active" },
    select: { id: true },
  });
  for (const c of channels) {
    ensureTelegramPoll(c.id);
  }
  logger.info(`Telegram ingest: ${channels.length} channel(s) polling`);
}

async function runLoop(channelId) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.type !== "telegram" || channel.status !== "active") {
    running.delete(channelId);
    return;
  }

  let config;
  try {
    config = decryptJson(channel.configEnc);
  } catch (e) {
    logger.error(`telegram decrypt channel ${channelId}`, e);
    running.delete(channelId);
    return;
  }

  const botToken = config.botToken;
  if (!botToken) {
    running.delete(channelId);
    return;
  }

  await deleteWebhook(botToken);

  let offset = 0;
  while (running.has(channelId)) {
    try {
      const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("timeout", "30");

      const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
      const data = await res.json().catch(() => ({}));

      if (!data.ok) {
        logger.warn("getUpdates", data);
        await sleep(2000);
        continue;
      }

      for (const u of data.result || []) {
        offset = u.update_id + 1;
        await handleUpdate(channel, botToken, u);
      }
    } catch (e) {
      logger.error("getUpdates loop", e);
      await sleep(2000);
    }
  }
}

async function handleUpdate(channel, botToken, update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const text = msg.text || msg.caption;
  if (!text) {
    await tgApi(botToken, "sendMessage", {
      chat_id: msg.chat.id,
      text: "Пока обрабатываю только текстовые сообщения.",
    });
    return;
  }

  const meta = {
    chatId: msg.chat.id,
    messageId: msg.message_id,
    from: msg.from
      ? { id: msg.from.id, username: msg.from.username, first_name: msg.from.first_name }
      : null,
    chat: { type: msg.chat.type, title: msg.chat.title },
  };

  const inbound = await prisma.message.create({
    data: {
      userId: channel.userId,
      channelId: channel.id,
      externalId: String(msg.message_id),
      direction: "inbound",
      body: text,
      meta: JSON.stringify(meta),
    },
  });

  const sessionKey = `comrade-tg-${channel.id}-${msg.chat.id}`;
  let replyText;
  if (isOpenClawConfigured()) {
    try {
      replyText = await openClawChatCompletion({
        userText: text,
        sessionKey,
      });
    } catch (e) {
      logger.error("openclaw chat", e);
      replyText = `Не удалось получить ответ от OpenClaw: ${e.message || "ошибка"}`;
    }
  } else {
    replyText =
      "OpenClaw не подключён: задайте OPENCLAW_GATEWAY_TOKEN в .env бэкенда Comrade и включите в OpenClaw endpoint chat/completions (см. README).";
  }

  if (replyText.length > 4000) {
    replyText = replyText.slice(0, 3997) + "…";
  }

  const sent = await tgApi(botToken, "sendMessage", {
    chat_id: msg.chat.id,
    text: replyText,
    reply_to_message_id: msg.message_id,
  });

  if (sent.ok && sent.result) {
    await prisma.message.create({
      data: {
        userId: channel.userId,
        channelId: channel.id,
        externalId: String(sent.result.message_id),
        direction: "outbound",
        body: replyText,
        meta: JSON.stringify({ replyToInboundId: inbound.id }),
      },
    });
  }
}
