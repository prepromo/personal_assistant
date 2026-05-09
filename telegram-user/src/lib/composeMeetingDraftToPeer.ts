import { prisma } from "./prisma.js";
import { runChatCompletion, type ChatMsg } from "./llm/chatCompletion.js";

const SYSTEM = [
  "Ты пишешь ОДНО сообщение контакту в Telegram от имени владельца.",
  "Цель: довести предложение созвона/встречи до назначения точного времени.",
  "КРИТИЧНО: не выдумывай даты/время/место. Если точного времени в переписке нет — спроси удобные окна и предложи 2–3 нейтральных слота «сегодня/завтра» без конкретных обещаний (как варианты).",
  "Если в transcript уже есть конкретное время/дата — используй её дословно (как написано), и попроси подтвердить.",
  "Тон: коротко, дружелюбно, без канцелярита. 1–7 предложений. Без markdown. Без заголовков.",
  "Вывод: только текст сообщения.",
].join("\n");

function stripOuterQuotes(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-zA-Z]*\n?/i, "").replace(/\n?```\s*$/i, "");
  t = t.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("«") && t.endsWith("»"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
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

export async function composeMeetingDraftToPeer(params: {
  dialogId: string;
  peerLabel: string;
  taskTitle: string;
  taskObjective: string;
}): Promise<string> {
  const { dialogId, peerLabel, taskTitle, taskObjective } = params;
  const lines = await transcriptLines(dialogId);
  const maxTok = Math.min(700, Math.max(220, Number(process.env.COMRADE_MEETING_DRAFT_MAX_TOKENS) || 420));
  const temperature = Math.min(0.6, Math.max(0, Number(process.env.COMRADE_MEETING_DRAFT_TEMPERATURE) || 0.2));

  const user: ChatMsg = {
    role: "user",
    content: JSON.stringify({
      peer: peerLabel.slice(0, 120),
      task_title: taskTitle.slice(0, 200),
      task_objective: taskObjective.slice(0, 1200),
      transcript: lines.join("\n").slice(0, 6000),
    }),
  };

  try {
    const { content } = await runChatCompletion([{ role: "system", content: SYSTEM }, user], {
      maxTokens: maxTok,
      temperature,
    });
    const cleaned = stripOuterQuotes(content).slice(0, 4096);
    if (cleaned.length >= 8) return cleaned;
  } catch {
    // fall back
  }

  const obj = taskObjective.trim();
  return [
    "Привет! Давай созвонимся/встретимся и обсудим диплом.",
    obj ? `Контекст: ${obj.slice(0, 220)}` : "",
    "",
    "Когда тебе удобно? Можешь предложить пару вариантов по времени (сегодня/завтра).",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4096);
}

