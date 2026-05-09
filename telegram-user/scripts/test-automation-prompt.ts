/**
 * Smoke LLM (system text — заглушка; автоответы по входящим в продукте отключены).
 * Запуск из каталога telegram-user: npx tsx scripts/test-automation-prompt.ts
 */
import "dotenv/config";
import { runChatCompletion, type ChatMsg } from "../src/lib/llm/chatCompletion.js";
import {
  getAutomationLlmOptionsForTests,
  getAutomationSystemContent,
} from "../src/lib/automationProcessor.js";

function printLlmPrereqHint(): void {
  const gw = process.env.OPENCLAW_GATEWAY_URL?.trim();
  const gwTok = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (gw && gwTok) {
    console.log(
      `LLM: OPENCLAW_GATEWAY_URL задан — gateway должен быть запущен (${gw}). Обычно: из корня репозитория .\\scripts\\start-tg-stack.ps1\n`,
    );
    return;
  }
  const base =
    process.env.CABINET_OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "http://127.0.0.1:8090/v1";
  console.log(`LLM base URL (по .env): ${base}`);
  console.log(
    "Если connect ECONNREFUSED :8090 — gpt2giga не запущен. Поднимите стек: из корня .\\scripts\\start-tg-stack.ps1 (или только компонент, который слушает этот порт).\n",
  );
}

async function main(): Promise<void> {
  printLlmPrereqHint();
  const system = getAutomationSystemContent();
  const opts = getAutomationLlmOptionsForTests();

  const scenarios: { name: string; messages: ChatMsg[] }[] = [
    {
      name: "просьба вести диалог без мета",
      messages: [
        { role: "system", content: system },
        { role: "user", content: "Ок, дальше без лишнего. Просто ведём диалог." },
      ],
    },
    {
      name: "как в переписке: уточнение роли",
      messages: [
        { role: "system", content: system },
        { role: "user", content: "Давай. Что конкретнее ты хочешь знать?" },
        { role: "assistant", content: "Пока разбираюсь с темой. Расскажи, что для тебя сейчас важнее." },
        { role: "user", content: "Ты отвечаешь от моего имени. Отвечай по сути, без разговоров про рамки." },
      ],
    },
    {
      name: "последняя реплика — согласие",
      messages: [
        { role: "system", content: system },
        { role: "user", content: "Мы уже всё определили. Идём дальше?" },
      ],
    },
  ];

  for (const s of scenarios) {
    console.log("\n=== " + s.name + " ===\n");
    try {
      const { content, provider } = await runChatCompletion(s.messages, opts);
      console.log("provider:", provider);
      console.log("--- ответ ---");
      console.log(content.trim());
    } catch (e) {
      console.error("Ошибка:", e instanceof Error ? e.message : e);
    }
  }
}

void main();
