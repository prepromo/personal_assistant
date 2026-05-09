import { prisma } from "./prisma.js";
import { isPrismaDbUnreachable, logThrottledDbUnreachable } from "./prismaUnreachable.js";
import { sendProductBotMessage, sendProductBotMessageInline } from "./telegramBotSend.js";

function snoozeMinutes(): number {
  const n = Number(process.env.REMINDER_SNOOZE_MINUTES);
  if (Number.isFinite(n) && n >= 1 && n <= 24 * 60) return Math.floor(n);
  return 60;
}

/**
 * Раз в intervalMs ищет напоминания с fireAt <= now и status=pending,
 * — с TgAccount: TgPendingSend peer me (кроме requiresBotAck);
 * — requiresBotAck: сообщение в бот с inline «Сделано» / «Ещё нет» → awaiting_confirm;
 * — без MTProto: PRODUCT_BOT_TOKEN → sendMessage пользователю по привязке TgBotUserBinding.
 */
export function startReminderScheduler(intervalMs = 15_000): () => void {
  const tick = async () => {
    try {
      const now = new Date();
      const due = await prisma.reminder.findMany({
        where: { status: "pending", fireAt: { lte: now } },
        take: 30,
        orderBy: { fireAt: "asc" },
      });

      for (const r of due) {
        if (r.requiresBotAck) {
          const bind = await prisma.tgBotUserBinding.findFirst({
            where: { appUserId: r.appUserId },
          });
          if (!bind) {
            console.warn(`reminderScheduler: requiresBotAck but no binding appUserId=${r.appUserId}`);
            continue;
          }
          const line = `Напоминание: ${r.title}\n\n${r.text}`.slice(0, 3900);
          const rid = r.id;
          const kb = {
            inline_keyboard: [
              [
                { text: "Сделано", callback_data: `rem:ok:${rid}` },
                { text: "Ещё нет", callback_data: `rem:zz:${rid}` },
              ],
            ],
          };
          const ok = await sendProductBotMessageInline(bind.telegramUserId, line, kb);
          if (ok) {
            await prisma.reminder.update({
              where: { id: r.id },
              data: {
                status: "awaiting_confirm",
                telegramSentAt: new Date(),
              },
            });
          }
          continue;
        }

        let telegramSentAt: Date | null = null;
        const webSentAt = r.notifyWeb ? new Date() : null;

        if (r.notifyTelegram && r.accountId) {
          const line = `Напоминание: ${r.title}\n\n${r.text}`;
          await prisma.tgPendingSend.create({
            data: {
              accountId: r.accountId,
              peerKey: "me",
              text: line.slice(0, 4096),
              status: "pending",
            },
          });
          telegramSentAt = new Date();
        } else if (r.notifyTelegram && !r.accountId) {
          const bind = await prisma.tgBotUserBinding.findFirst({
            where: { appUserId: r.appUserId },
          });
          if (bind) {
            const line = `Напоминание: ${r.title}\n\n${r.text}`;
            const ok = await sendProductBotMessage(bind.telegramUserId, line.slice(0, 4096));
            if (ok) telegramSentAt = new Date();
          }
        }

        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: "sent",
            telegramSentAt,
            webSentAt,
          },
        });
      }
    } catch (e) {
      if (isPrismaDbUnreachable(e)) {
        logThrottledDbUnreachable("reminderScheduler");
        return;
      }
      console.error("reminderScheduler:", e);
    }
  };

  const id = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return () => clearInterval(id);
}
