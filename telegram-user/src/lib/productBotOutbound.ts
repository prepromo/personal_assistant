import { prisma } from "./prisma.js";
import { defaultPolicy, parsePolicy } from "./policy.js";

/** Исходящее в личный Telegram через очередь TgPendingSend (воркер Pyrogram). */
export async function enqueueUserAccountOutbound(
  appUserId: string,
  accountId: string,
  dialogId: string,
  text: string,
): Promise<{ ok: boolean; message: string }> {
  const dlg = await prisma.tgDialog.findFirst({
    where: { id: dialogId, accountId },
  });
  if (!dlg) return { ok: false, message: "Чат не найден." };
  const tg = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!tg || tg.appUserId !== appUserId) return { ok: false, message: "Нет доступа к аккаунту." };
  const policy = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  if (policy.sendAllowed === false) {
    return { ok: false, message: "В политике аккаунта отключена отправка сообщений (sendAllowed)." };
  }
  await prisma.tgPendingSend.create({
    data: {
      accountId,
      peerKey: dlg.peerKey,
      text: text.slice(0, 4096),
      status: "pending",
    },
  });
  return {
    ok: true,
    message: "Сообщение поставлено в очередь — воркер отправит его с вашего личного аккаунта.",
  };
}

/** Черновик исходящего: создаёт TgPendingSend со статусом awaiting_confirm (воркер не отправит, пока бот не подтвердит). */
export async function enqueueUserAccountOutboundAwaitingConfirm(
  appUserId: string,
  accountId: string,
  dialogId: string,
  text: string,
): Promise<{ ok: boolean; pendingId: string | null; message: string }> {
  const dlg = await prisma.tgDialog.findFirst({
    where: { id: dialogId, accountId },
  });
  if (!dlg) return { ok: false, pendingId: null, message: "Чат не найден." };
  const tg = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!tg || tg.appUserId !== appUserId) return { ok: false, pendingId: null, message: "Нет доступа к аккаунту." };
  const policy = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  if (policy.sendAllowed === false) {
    return { ok: false, pendingId: null, message: "В политике аккаунта отключена отправка сообщений (sendAllowed)." };
  }
  const row = await prisma.tgPendingSend.create({
    data: {
      accountId,
      peerKey: dlg.peerKey,
      text: text.slice(0, 4096),
      status: "awaiting_confirm",
    },
    select: { id: true },
  });
  return {
    ok: true,
    pendingId: row.id,
    message: "Черновик создан — подтвердите отправку в боте.",
  };
}
