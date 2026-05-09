import { runChatCompletion, type ChatMsg } from "./llm/chatCompletion.js";
import type { ComradeTemplateType } from "./prismaComradeTypes.js";
import { COMRADE_TEMPLATES, buildFirstMessage } from "./comradeTemplates.js";

const POLISH_SYSTEM = [
  "Ты редактор: из описания задачи и шаблонного черновика составляешь **одно** короткое сообщение в Telegram **от пользователя к живому контакту**.",
  "Запрещено: дословно повторять мета-инструкции вроде «напиши пользователю …», «попроси …», «пусть вышлет …», длинные цитаты в «ёлочках» с полным заданием, канцелярит «Напоминаю о договорённости по…» с вложенным дословным текстом задания.",
  "Нужно: естественный русский, 1–5 коротких предложений, по сути (диплом, срок, документ, встреча — из контекста). Без преамбулы «Конечно», без объяснений, что ты бот.",
  "Вывод: **только** текст сообщения, который можно отправить как есть. Без префикса «Сообщение:».",
].join("\n");

function stripOuterQuotes(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
  t = t.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("«") && t.endsWith("»"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Черновик «написать первым» по шаблону Comrade: сначала механическая подстановка,
 * затем (если включено и LLM доступен) — короткое живое сообщение контакту без копирования инструкций боту.
 */
export async function composeComradeFirstMessageToPeer(
  templateType: ComradeTemplateType,
  title: string,
  objective: string,
  peerLabel?: string,
): Promise<{ text: string; usedPolish: boolean }> {
  const mechanical = buildFirstMessage(templateType, title, objective).slice(0, 4096);
  const polishOff = process.env.PRODUCT_BOT_COMRADE_POLISH?.trim() === "0";
  if (polishOff) return { text: mechanical, usedPolish: false };

  const t = COMRADE_TEMPLATES[templateType];
  const maxTok = Math.min(
    600,
    Math.max(200, Number(process.env.PRODUCT_BOT_COMRADE_POLISH_MAX_TOKENS) || 380),
  );
  const userBlock = [
    `Тип задачи: ${t.nameRu}.`,
    `Краткое название: ${title.trim()}`,
    "",
    "Пожелание / контекст (может быть сформулировано как указание боту — в итоговом сообщении контакту этого не должно быть видно):",
    objective.trim().slice(0, 3500),
    peerLabel ? `\nКонтакт (подпись в списке): ${peerLabel}` : "",
    "",
    "Черновик по шаблону (если он корявый или слишком официальный — перепиши целиком):",
    mechanical.slice(0, 2000),
  ].join("\n");

  try {
    const messages: ChatMsg[] = [
      { role: "system", content: POLISH_SYSTEM },
      { role: "user", content: userBlock },
    ];
    const { content } = await runChatCompletion(messages, {
      maxTokens: maxTok,
      temperature: 0.32,
    });
    const cleaned = stripOuterQuotes(content).slice(0, 4096);
    if (cleaned.length < 10) return { text: mechanical, usedPolish: false };
    return { text: cleaned, usedPolish: true };
  } catch {
    return { text: mechanical, usedPolish: false };
  }
}
