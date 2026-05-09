import { prisma } from "./prisma.js";

export const MAX_USER_NOTES = 10;
export const MAX_ACTIVE_REMINDERS = 10;

/** Активные напоминания: ещё не завершённые и не отменённые */
export async function countActiveReminders(appUserId: string): Promise<number> {
  return prisma.reminder.count({
    where: {
      appUserId,
      status: { in: ["pending", "awaiting_confirm"] },
    },
  });
}

export async function countUserNotes(appUserId: string): Promise<number> {
  return prisma.userNote.count({ where: { appUserId } });
}

export async function assertCanAddNote(appUserId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const n = await countUserNotes(appUserId);
  if (n >= MAX_USER_NOTES) {
    return {
      ok: false,
      message: `Достигнут лимит **${MAX_USER_NOTES}** активных заметок. Удалите старые в разделе **Заметки** или командой /notes.`,
    };
  }
  return { ok: true };
}

export async function assertCanAddReminder(
  appUserId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const n = await countActiveReminders(appUserId);
  if (n >= MAX_ACTIVE_REMINDERS) {
    return {
      ok: false,
      message: `Достигнут лимит **${MAX_ACTIVE_REMINDERS}** активных напоминаний. Удалите или дождитесь срабатывания.`,
    };
  }
  return { ok: true };
}
