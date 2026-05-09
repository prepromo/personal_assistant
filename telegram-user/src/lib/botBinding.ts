import type { ComradeTemplateType } from "./prismaComradeTypes.js";
import { prisma } from "./prisma.js";
import type { NlPendingPayload } from "./productBotNl.js";

export function appUserIdFromTelegramUser(telegramUserId: number | string): string {
  return `bot-${telegramUserId}`;
}

export async function ensureBotBinding(telegramUserId: number): Promise<{ appUserId: string; bindingId: string }> {
  const tid = String(telegramUserId);
  const existing = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (existing) {
    return { appUserId: existing.appUserId, bindingId: existing.id };
  }
  const guestAppUserId = appUserIdFromTelegramUser(telegramUserId);
  const row = await prisma.tgBotUserBinding.create({
    data: {
      telegramUserId: tid,
      appUserId: guestAppUserId,
      metaJson: JSON.stringify({ onboardingDone: false, onboardingStep: 0, step: "idle" }),
    },
  });
  return { appUserId: guestAppUserId, bindingId: row.id };
}

export type DialogMeta = {
  /** Онбординг: пока false — показываем шаги после /start */
  onboardingDone?: boolean;
  onboardingStep?: number;
  step?:
    | "idle"
    | "mtproto_phone"
    | "mtproto_code"
    | "mtproto_2fa"
    | "task_title"
    | "rem_title"
    | "rem_text"
    | "rem_time"
    | "add_chat_id"
    | "note_body"
    | "agent_create_name"
    | "agent_confirm"
    | "agent_edit_prompt"
    | "sub_pick_mtproto"
    | "sub_pick_bot"
    | "rem_1"
    | "rem_2"
    | "rem_3"
    | "rem_confirm"
    | "out_1"
    | "out_confirm"
    | "nl_pick_chats"
    | "nl_confirm"
    | "comrade_title"
    | "comrade_objective"
    | "comrade_pick_dialog"
    | "rem_reschedule";
  /** Подтверждение NL-команды (кнопки в боте) */
  nlPending?: NlPendingPayload;
  /** Выбранные `tgDialog.id` перед подтверждением create_agent / task_agent_reminder */
  nlPickChatIds?: string[];
  /** Страница списка чатов (шаг nl_pick_chats) */
  nlPickChatsPage?: number;
  rem?: { fireAtIso?: string; title?: string; text?: string; minutes?: number };
  /** Черновик исходящего в личный Telegram (после подтверждения → TgPendingSend) */
  outboundDraft?: { dialogId: string; text: string; comradeTaskId?: string };
  /** Диалог для шага «Написать первым» */
  outPickDialogId?: string;
  /** Временное поле для назначения диалога агенту */
  assignAgentId?: string;
  /** Выбор чата в разделе «Режим чатов» → назначить агента */
  chatPickDialogId?: string;
  agentEditId?: string;
  /** Черновое имя агента перед подтверждением */
  agentCreateDraft?: string;
  /** Мастер задачи Comrade MVP */
  comradeTemplateType?: ComradeTemplateType;
  comradeTitleDraft?: string;
  comradeObjectiveDraft?: string;
  comradeDialogPickPage?: number;
  /** Черновик отправки по задаче Comrade (если outboundDraft сброшен на шаге правки) */
  comradeOutboundTaskId?: string;
  /** Перенос напоминания: id записи */
  remRescheduleId?: string;
  /** Временные данные мастера MTProto (телефон после send_code) */
  mtprotoDraft?: { phone?: string };
  /** История свободного чата с LLM в личке (последние реплики, режется в productBotChat) */
  productChatHistory?: { role: "user" | "assistant"; content: string }[];
  /** Обучение по курсу (кнопка «Обучение»): индекс шага 0..n */
  courseStep?: number;
  /** Пользователь нажал «Я всё понял» */
  courseDone?: boolean;
  /** Разрешить агенту дописывать заметки (настройка; логика записи — по мере внедрения) */
  allowAgentNotes?: boolean;
};

export async function getDialogMeta(telegramUserId: number): Promise<DialogMeta> {
  const tid = String(telegramUserId);
  const b = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!b?.metaJson) return { step: "idle", onboardingDone: true };
  try {
    const raw = JSON.parse(b.metaJson) as DialogMeta;
    if (raw.onboardingDone === undefined) raw.onboardingDone = true;
    return raw;
  } catch {
    return { step: "idle", onboardingDone: true };
  }
}

export async function setDialogMeta(telegramUserId: number, meta: DialogMeta): Promise<void> {
  const tid = String(telegramUserId);
  const prev = await getDialogMeta(telegramUserId);
  await prisma.tgBotUserBinding.update({
    where: { telegramUserId: tid },
    data: { metaJson: JSON.stringify({ ...prev, ...meta }) },
  });
}

export async function resetDialogMeta(telegramUserId: number): Promise<void> {
  const tid = String(telegramUserId);
  await prisma.tgBotUserBinding.update({
    where: { telegramUserId: tid },
    data: { metaJson: "{}" },
  });
}

/** Сброс FSM (заметки, агенты…), без сброса онбординга. */
export async function resetDialogFsm(telegramUserId: number): Promise<void> {
  const tid = String(telegramUserId);
  const prev = await getDialogMeta(telegramUserId);
  const next: DialogMeta = {
    onboardingDone: prev.onboardingDone,
    onboardingStep: prev.onboardingStep,
    step: "idle",
    productChatHistory: prev.productChatHistory,
  };
  await prisma.tgBotUserBinding.update({
    where: { telegramUserId: tid },
    data: { metaJson: JSON.stringify(next) },
  });
}
