import type { Bot, NextFunction } from "grammy";
import { prisma } from "./prisma.js";

const LOG_PREFIX = "[botChannelIngest]";

function extractText(msg: {
  text?: string;
  caption?: string;
}): string {
  return (msg.text || msg.caption || "").trim();
}

/**
 * Сохраняет сообщения из групп/каналов, где бот добавлен и чат есть в BotConnectedChat.
 */
export function registerBotChannelIngest(bot: Bot): void {
  bot.on("channel_post", async (ctx, next: NextFunction) => {
    const post = ctx.channelPost;
    const chat = ctx.chat;
    if (!post || !chat?.id) return next();
    const telegramChatId = String(chat.id);
    const rows = await prisma.botConnectedChat.findMany({
      where: { telegramChatId },
      select: { appUserId: true },
    });
    if (rows.length === 0) return next();
    const text = extractText(post);
    const rawJson = JSON.stringify({ chat: chat, post }).slice(0, 16000);
    const date = new Date(post.date * 1000);
    for (const r of rows) {
      try {
        await prisma.botChannelPost.create({
          data: {
            appUserId: r.appUserId,
            telegramChatId,
            messageId: post.message_id,
            date,
            text: text.slice(0, 8000),
            rawJson,
          },
        });
        console.info(`${LOG_PREFIX} channel_post chat=${telegramChatId} msg=${post.message_id} user=${r.appUserId}`);
      } catch {
        /* duplicate */
      }
    }
    return next();
  });

  bot.on("message", async (ctx, next: NextFunction) => {
    const msg = ctx.message;
    const chat = ctx.chat;
    if (!msg || !chat?.id) return next();
    const t = chat.type;
    if (t !== "group" && t !== "supergroup") return next();
    const telegramChatId = String(chat.id);
    const rows = await prisma.botConnectedChat.findMany({
      where: { telegramChatId },
      select: { appUserId: true },
    });
    if (rows.length === 0) return next();
    const text = extractText(msg);
    if (!text && !msg.caption) return next();
    const rawJson = JSON.stringify({ chat, message: msg }).slice(0, 16000);
    const date = new Date(msg.date * 1000);
    for (const r of rows) {
      try {
        await prisma.botChannelPost.create({
          data: {
            appUserId: r.appUserId,
            telegramChatId,
            messageId: msg.message_id,
            date,
            text: text.slice(0, 8000),
            rawJson,
          },
        });
        console.info(`${LOG_PREFIX} group msg chat=${telegramChatId} msg=${msg.message_id} user=${r.appUserId}`);
      } catch {
        /* duplicate */
      }
    }
    return next();
  });
}
