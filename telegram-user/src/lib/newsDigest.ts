import { prisma } from "./prisma.js";
import { isPrismaDbUnreachable, logThrottledDbUnreachable } from "./prismaUnreachable.js";
import { runChatCompletion } from "./llm/chatCompletion.js";
import { sendProductBotMessage } from "./telegramBotSend.js";
import type { NewsSubscription } from "@prisma/client";

const LOG_PREFIX = "[newsDigest]";

async function summarizeDigest(raw: string, title: string): Promise<string> {
  const { content } = await runChatCompletion(
    [
      {
        role: "system",
        content:
          "Сожми сообщения из чата в краткий дайджест на русском (5–10 пунктов). Только факты и темы, без вводных фраз.",
      },
      {
        role: "user",
        content: `Источник: ${title}\n\n${raw}`,
      },
    ],
    { maxTokens: 1024, temperature: 0.25 },
  );
  return content.trim();
}

export async function runDigestForSubscription(
  sub: NewsSubscription,
  opts?: { ignoreLastDigest?: boolean; windowHours?: number },
): Promise<boolean> {
  const windowH = opts?.windowHours ?? 48;
  const since = opts?.ignoreLastDigest
    ? new Date(Date.now() - windowH * 3600 * 1000)
    : sub.lastDigestAt ?? new Date(Date.now() - windowH * 3600 * 1000);
  let lines: string[] = [];

  if (sub.sourceKind === "mtproto_dialog") {
    const acc = await prisma.tgAccount.findUnique({ where: { appUserId: sub.appUserId } });
    if (!acc) {
      console.info(`${LOG_PREFIX} skip mtproto: no TgAccount appUserId=${sub.appUserId}`);
      return false;
    }
    const dlg = await prisma.tgDialog.findFirst({
      where: { id: sub.sourceId, accountId: acc.id },
    });
    if (!dlg) {
      console.info(`${LOG_PREFIX} skip mtproto: dialog not found ${sub.sourceId}`);
      return false;
    }
    const msgs = await prisma.tgMessage.findMany({
      where: { dialogId: sub.sourceId, date: { gt: since } },
      orderBy: { date: "asc" },
      take: 100,
    });
    lines = msgs.map((m) => `[${m.date.toISOString()}] ${(m.text || "").trim().slice(0, 600)}`);
  } else if (sub.sourceKind === "bot_chat") {
    const msgs = await prisma.botChannelPost.findMany({
      where: {
        appUserId: sub.appUserId,
        telegramChatId: sub.sourceId,
        date: { gt: since },
      },
      orderBy: { date: "asc" },
      take: 100,
    });
    lines = msgs.map((m) => `[${m.date.toISOString()}] ${m.text.trim().slice(0, 600)}`);
  } else {
    return false;
  }

  if (lines.length === 0) {
    console.info(`${LOG_PREFIX} no new items sub=${sub.id}`);
    return false;
  }

  const bind = await prisma.tgBotUserBinding.findFirst({ where: { appUserId: sub.appUserId } });
  if (!bind) {
    console.info(`${LOG_PREFIX} no Telegram binding appUserId=${sub.appUserId}`);
    return false;
  }

  const raw = lines.join("\n").slice(0, 12000);
  const title = sub.title || `${sub.sourceKind}:${sub.sourceId}`;
  let digest: string;
  try {
    digest = await summarizeDigest(raw, title);
  } catch (e) {
    console.error(`${LOG_PREFIX} LLM failed`, e);
    digest = raw.slice(0, 3500);
  }

  const out = `📰 ${title}\n\n${digest}`.slice(0, 4096);
  const ok = await sendProductBotMessage(bind.telegramUserId, out);
  if (!ok) return false;

  await prisma.newsSubscription.update({
    where: { id: sub.id },
    data: { lastDigestAt: new Date() },
  });
  console.info(`${LOG_PREFIX} sent sub=${sub.id} appUserId=${sub.appUserId}`);
  return true;
}

/** Периодический опрос: все включённые подписки. */
export function startNewsDigestScheduler(intervalMs = 900_000): () => void {
  const tick = () => {
    void (async () => {
      try {
        const subs = await prisma.newsSubscription.findMany({ where: { enabled: true } });
        for (const sub of subs) {
          await runDigestForSubscription(sub);
        }
      } catch (e) {
        if (isPrismaDbUnreachable(e)) {
          logThrottledDbUnreachable(LOG_PREFIX);
          return;
        }
        console.error(`${LOG_PREFIX} tick`, e);
      }
    })();
  };
  void tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}

/** Ручной запуск: все подписки пользователя. */
export async function runNewsDigestsForAppUser(
  appUserId: string,
  manual = false,
): Promise<{ ok: number; empty: number }> {
  const subs = await prisma.newsSubscription.findMany({
    where: { appUserId, enabled: true },
  });
  let ok = 0;
  let empty = 0;
  for (const sub of subs) {
    const sent = await runDigestForSubscription(sub, manual ? { ignoreLastDigest: true, windowHours: 72 } : undefined);
    if (sent) ok++;
    else empty++;
  }
  return { ok, empty };
}
