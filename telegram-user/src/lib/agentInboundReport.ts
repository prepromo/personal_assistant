/**
 * После входящего MTProto-сообщения: отчёт владельцу в продуктовый бот (Bot API).
 * Приоритет: активная ComradeTask по привязанному чату; иначе — ProductAgentDialog (legacy).
 * Исходящих в Telegram собеседнику здесь нет — только уведомление владельцу.
 */
import type { ProductAgent } from "@prisma/client";
import type { ComradeTask } from "./prismaComradeTypes.js";
import { dbComradeTask, prisma } from "./prisma.js";
import { runChatCompletion, type ChatMsg } from "./llm/chatCompletion.js";
import { sendProductBotMessage, sendProductBotMessageInline } from "./telegramBotSend.js";
import { COMRADE_TEMPLATES } from "./comradeTemplates.js";
import { findComradeTaskForInbound } from "./comradeTaskService.js";

function featureEnabled(): boolean {
  const v = process.env.AGENT_INBOUND_REPORT?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

function minConfidenceOfferDisable(): number {
  const n = Number(process.env.AGENT_REPORT_OFFER_DISABLE_MIN_CONFIDENCE);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.55;
}

function reportMaxTokens(): number {
  return Math.min(1024, Math.max(200, Number(process.env.AGENT_REPORT_MAX_TOKENS) || 600));
}

function reportTemperature(): number {
  return Math.min(0.9, Math.max(0, Number(process.env.AGENT_REPORT_TEMPERATURE) || 0.25));
}

export type AgentReportLlmOut = {
  owner_report: string;
  all_steps_done: boolean;
  confidence: number;
};

export type ComradeReportLlmOut = {
  what_happened: string;
  goal_achieved: boolean;
  what_next: string;
  confidence: number;
  /** Встреча упомянута как предложение/договорённость (только если есть цитаты-основания из transcript). */
  meeting_proposed?: boolean;
  meeting_scheduled?: boolean;
  meeting_time_text?: string;
  evidence_quotes?: string[];
};

/** Извлекает JSON из ответа LLM (возможны обрамления ```). */
export function parseAgentReportLlmJson(raw: string): AgentReportLlmOut | null {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const owner_report = typeof j.owner_report === "string" ? j.owner_report : "";
    const all_steps_done = Boolean(j.all_steps_done);
    let confidence = Number(j.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.min(1, Math.max(0, confidence));
    if (!owner_report.trim()) return null;
    return { owner_report: owner_report.trim(), all_steps_done, confidence };
  } catch {
    return null;
  }
}

export function parseComradeReportLlmJson(raw: string): ComradeReportLlmOut | null {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const what_happened = typeof j.what_happened === "string" ? j.what_happened : "";
    const what_next = typeof j.what_next === "string" ? j.what_next : "";
    const goal_achieved = Boolean(j.goal_achieved);
    let confidence = Number(j.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.min(1, Math.max(0, confidence));
    if (!what_happened.trim()) return null;
    const evidence_quotes = Array.isArray(j.evidence_quotes)
      ? j.evidence_quotes
          .filter((x) => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    let meeting_proposed = Boolean(j.meeting_proposed);
    let meeting_scheduled = Boolean(j.meeting_scheduled);
    const meeting_time_text = typeof j.meeting_time_text === "string" ? j.meeting_time_text.trim().slice(0, 120) : "";
    // Anti-hallucination: meeting flags require explicit transcript quotes.
    if (evidence_quotes.length === 0) {
      meeting_proposed = false;
      meeting_scheduled = false;
    }
    return {
      what_happened: what_happened.trim(),
      goal_achieved,
      what_next: what_next.trim(),
      confidence,
      ...(meeting_proposed ? { meeting_proposed } : {}),
      ...(meeting_scheduled ? { meeting_scheduled } : {}),
      ...(meeting_time_text ? { meeting_time_text } : {}),
      ...(evidence_quotes.length ? { evidence_quotes } : {}),
    };
  } catch {
    return null;
  }
}

export async function maybeScheduleAgentInboundReport(params: {
  accountId: string;
  dialogId: string;
  tgMessageId: number;
  outgoing: boolean;
}): Promise<void> {
  if (!featureEnabled() || params.outgoing) return;
  void runAgentInboundReport(params).catch((e) =>
    console.error("[agentInboundReport]", e instanceof Error ? e.message : e),
  );
}

async function transcriptLines(dialogId: string): Promise<string[]> {
  const rows = await prisma.tgMessage.findMany({
    where: { dialogId },
    orderBy: { date: "asc" },
    take: 40,
  });
  const tail = rows.slice(-25);
  return tail.map((m) => `${m.out ? "Вы" : "Собеседник"}: ${(m.text || "").trim() || "(без текста)"}`);
}

async function runComradeInboundReport(params: {
  accountId: string;
  dialogId: string;
  tgMessageId: number;
  task: ComradeTask;
  bindTelegramUserId: string;
}): Promise<void> {
  const { accountId, dialogId, tgMessageId, task, bindTelegramUserId } = params;

  const needle = `"comradeTaskId":"${task.id}","tgMessageId":${tgMessageId}`;
  const dup = await prisma.tgAgentAuditLog.findFirst({
    where: {
      accountId,
      action: "comrade_inbound_report",
      resource: task.id,
      metaJson: { contains: needle },
    },
  });
  if (dup) return;

  const dlg = await prisma.tgDialog.findUnique({ where: { id: dialogId } });
  const tpl = COMRADE_TEMPLATES[task.templateType];
  const lines = await transcriptLines(dialogId);

  const system: ChatMsg = {
    role: "system",
    content: [
      "Ты советник владельца задачи. По фрагменту переписки верни СТРОГО один JSON без markdown и без текста до/после.",
      'Поля: "what_happened" (кратко по-русски — что нового после последнего входящего),',
      '"goal_achieved" (boolean — достигнута ли цель шаблона с учётом title/objective/goal шаблона),',
      '"what_next" (кратко: что предложить владельцу сделать дальше),',
      '"confidence" (0..1 — уверенность в goal_achieved).',
      'Дополнительно: "meeting_proposed" (boolean — в переписке есть предложение созвона/встречи),',
      '"meeting_scheduled" (boolean — встреча уже назначена/договорились),',
      '"meeting_time_text" (строка как написано у людей: день/время; пусто если нет),',
      '"evidence_quotes" (массив 1–3 коротких цитат из transcript, которые подтверждают meeting_*; если цитат нет — meeting_* должны быть false).',
      "КРИТИЧНО: не выдумывай факты. Любые даты/встречи/время — ТОЛЬКО если это явно есть в transcript и ты добавил цитату в evidence_quotes.",
      "Не предлагай отправлять сообщения автоматически — только анализ.",
    ].join("\n"),
  };
  const user: ChatMsg = {
    role: "user",
    content: JSON.stringify({
      template: tpl.nameRu,
      template_goal: tpl.goal,
      task_title: task.title,
      task_objective: task.objective,
      dialog_title: dlg?.title || dlg?.peerKey || "",
      last_inbound_tg_message_id: tgMessageId,
      transcript: lines.join("\n"),
    }),
  };

  let parsed: ComradeReportLlmOut;
  try {
    const { content } = await runChatCompletion([system, user], {
      maxTokens: reportMaxTokens(),
      temperature: reportTemperature(),
    });
    const p = parseComradeReportLlmJson(content);
    if (!p) {
      parsed = {
        what_happened: `Новое входящее в «${dlg?.title || "чат"}» (#${tgMessageId}). Не удалось разобрать ответ модели.`,
        goal_achieved: false,
        what_next: "Просмотрите переписку в Telegram и при необходимости подготовьте ответ вручную.",
        confidence: 0,
      };
    } else {
      parsed = p;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    parsed = {
      what_happened: `Новое входящее (#${tgMessageId}). Ошибка LLM: ${msg.slice(0, 400)}`,
      goal_achieved: false,
      what_next: "Повторите позже или ответьте вручную.",
      confidence: 0,
    };
  }

  await dbComradeTask.update({
    where: { id: task.id },
    data: {
      status: "RESPONSE_RECEIVED",
      lastReportAt: new Date(),
    },
  });

  const header = `Задача «${task.title.slice(0, 80)}» · ${tpl.nameRu} · ${dlg?.title || "чат"}`;
  const meetingBits: string[] = [];
  if (parsed.meeting_proposed) meetingBits.push("встреча предложена");
  if (parsed.meeting_scheduled) meetingBits.push("встреча назначена");
  if (parsed.meeting_time_text) meetingBits.push(`время: ${parsed.meeting_time_text}`);
  const evidence = (parsed.evidence_quotes || []).slice(0, 3);

  const body = [
    "Что произошло:",
    parsed.what_happened,
    ...(meetingBits.length ? ["", `Встреча: ${meetingBits.join(", ")}.`] : []),
    ...(evidence.length ? ["", "Основание (цитаты):", ...evidence.map((q) => `· ${q.slice(0, 120)}`)] : []),
    "",
    `Цель: ${parsed.goal_achieved ? "достигнута (оценка модели)" : "пока не достигнута"}; уверенность ${(parsed.confidence * 100).toFixed(0)}%.`,
    "",
    "Дальше:",
    parsed.what_next || "—",
  ]
    .join("\n")
    .slice(0, 3500);
  const fullText = `${header}\n\n${body}`.slice(0, 4096);

  const offerGoal = parsed.goal_achieved && parsed.confidence >= minConfidenceOfferDisable();
  const id = task.id;
  const kb = {
    inline_keyboard: [
      [
        { text: "Закрыть задачу", callback_data: `cr:c:${id}` },
        { text: "Напомнить позже", callback_data: `cr:z:${id}` },
      ],
      [
        { text: "Подготовить ответ", callback_data: `cr:r:${id}` },
        { text: "Отключить агента", callback_data: `cr:p:${id}` },
      ],
    ],
  };
  // If a meeting is mentioned as proposed but not scheduled, offer a one-click draft to clarify time and schedule it.
  if (parsed.meeting_proposed && !parsed.meeting_scheduled) {
    kb.inline_keyboard.unshift([{ text: "Назначить встречу (уточнить время)", callback_data: `cr:m:${id}` }]);
  }
  if (offerGoal) {
    kb.inline_keyboard.unshift([{ text: "Цель выполнена — закрыть", callback_data: `cr:g:${id}` }]);
  }

  const ok = await sendProductBotMessageInline(bindTelegramUserId, fullText, kb);
  if (!ok) await sendProductBotMessage(bindTelegramUserId, fullText);

  await prisma.tgAgentAuditLog.create({
    data: {
      accountId,
      actor: "system",
      action: "comrade_inbound_report",
      resource: task.id,
      metaJson: JSON.stringify({
        comradeTaskId: task.id,
        tgMessageId,
        goal_achieved: parsed.goal_achieved,
        confidence: parsed.confidence,
      }),
    },
  });
}

async function runProductAgentInboundReport(params: {
  accountId: string;
  dialogId: string;
  tgMessageId: number;
  link: {
    productAgent: ProductAgent;
    dialog: { title: string | null; peerKey: string } | null;
  };
  bindTelegramUserId: string;
}): Promise<void> {
  const { accountId, dialogId, tgMessageId, link, bindTelegramUserId } = params;

  const needle = `"tgMessageId":${tgMessageId}`;
  const dup = await prisma.tgAgentAuditLog.findFirst({
    where: {
      accountId,
      action: "agent_inbound_report",
      resource: dialogId,
      metaJson: { contains: needle },
    },
  });
  if (dup) return;

  const agent = link.productAgent;
  const lines = await transcriptLines(dialogId);

  const system: ChatMsg = {
    role: "system",
    content: [
      "Ты помощник владельца.",
      "По переписке и описанию агента верни СТРОГО один JSON-объект без markdown и без текста до/после.",
      'Поля: "owner_report" (кратко по-русски: что изменилось после последнего входящего),',
      '"all_steps_done" (boolean — выполнены ли все шаги/цели агента в этом чате с учётом planJson и promptExtras),',
      '"confidence" (число 0..1 — уверенность в all_steps_done).',
      "Если мало данных — всё равно заполни owner_report фактом нового сообщения, all_steps_done=false, confidence низкая.",
    ].join("\n"),
  };
  const user: ChatMsg = {
    role: "user",
    content: JSON.stringify({
      agent_name: agent.name,
      planJson: (agent.planJson || "{}").slice(0, 4000),
      promptExtras: (agent.promptExtras || "").slice(0, 4000),
      dialog_title: link.dialog?.title || link.dialog?.peerKey || "",
      last_inbound_tg_message_id: tgMessageId,
      transcript: lines.join("\n"),
    }),
  };

  let parsed: AgentReportLlmOut;
  try {
    const { content } = await runChatCompletion([system, user], {
      maxTokens: reportMaxTokens(),
      temperature: reportTemperature(),
    });
    const p = parseAgentReportLlmJson(content);
    if (!p) {
      parsed = {
        owner_report: `Новое входящее в «${link.dialog?.title || "чат"}» (сообщение #${tgMessageId}). Не удалось разобрать ответ модели.`,
        all_steps_done: false,
        confidence: 0,
      };
    } else {
      parsed = p;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    parsed = {
      owner_report: `Новое входящее в «${link.dialog?.title || "чат"}» (#${tgMessageId}). Ошибка LLM: ${msg.slice(0, 500)}`,
      all_steps_done: false,
      confidence: 0,
    };
  }

  const header = `Агент «${agent.name}» · ${link.dialog?.title || "чат"}`;
  const body = parsed.owner_report.trim().slice(0, 3500);
  let fullText = `${header}\n\n${body}`.slice(0, 4096);

  const offerDisable = parsed.all_steps_done && parsed.confidence >= minConfidenceOfferDisable();

  const cbDis = `agr:dis:${agent.id}`;
  if (cbDis.length > 64) {
    console.warn("[agentInboundReport] callback_data too long, skip inline");
    await sendProductBotMessage(bindTelegramUserId, fullText);
  } else if (offerDisable) {
    const ok = await sendProductBotMessageInline(bindTelegramUserId, fullText, {
      inline_keyboard: [
        [{ text: "Отключить агента", callback_data: cbDis }],
        [{ text: "Закрыть открытые задачи", callback_data: "agr:tsk" }],
        [{ text: "Позже", callback_data: "agr:later" }],
      ],
    });
    if (!ok) {
      await sendProductBotMessage(bindTelegramUserId, fullText);
    }
  } else {
    await sendProductBotMessage(bindTelegramUserId, fullText);
  }

  await prisma.tgAgentAuditLog.create({
    data: {
      accountId,
      actor: "system",
      action: "agent_inbound_report",
      resource: dialogId,
      metaJson: JSON.stringify({
        tgMessageId,
        agentId: agent.id,
        all_steps_done: parsed.all_steps_done,
        confidence: parsed.confidence,
        offered_disable: offerDisable,
      }),
    },
  });
}

async function runAgentInboundReport(params: {
  accountId: string;
  dialogId: string;
  tgMessageId: number;
}): Promise<void> {
  const { accountId, dialogId, tgMessageId } = params;

  const acc = await prisma.tgAccount.findUnique({ where: { id: accountId } });
  if (!acc) return;
  const bind = await prisma.tgBotUserBinding.findFirst({ where: { appUserId: acc.appUserId } });
  if (!bind) {
    console.warn(`[agentInboundReport] no TgBotUserBinding appUserId=${acc.appUserId}`);
    return;
  }

  const comrade = await findComradeTaskForInbound(dialogId);
  if (comrade) {
    await runComradeInboundReport({
      accountId,
      dialogId,
      tgMessageId,
      task: comrade,
      bindTelegramUserId: bind.telegramUserId,
    });
    return;
  }

  const link = await prisma.productAgentDialog.findUnique({
    where: { dialogId },
    include: { productAgent: true, dialog: true },
  });
  if (!link?.productAgent.enabled) return;

  await runProductAgentInboundReport({
    accountId,
    dialogId,
    tgMessageId,
    link: { productAgent: link.productAgent, dialog: link.dialog },
    bindTelegramUserId: bind.telegramUserId,
  });
}
