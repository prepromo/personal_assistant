/**
 * Локальная проверка: API /health + Telegram getMe (PRODUCT_BOT_TOKEN).
 * Запуск из каталога telegram-user: npm run verify:local
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const port = process.env.PORT || "4050";
const base = `http://127.0.0.1:${port}`;

let ok = true;
try {
  const h = await fetch(`${base}/health`);
  const j = await h.json();
  console.log("GET /health:", JSON.stringify(j, null, 2));
  if (!j.ok) {
    console.error("health.ok is false");
    ok = false;
  }
} catch (e) {
  console.error("GET /health failed:", e instanceof Error ? e.message : e);
  ok = false;
}

const token = process.env.PRODUCT_BOT_TOKEN?.trim();
if (!token) {
  console.error("PRODUCT_BOT_TOKEN missing");
  process.exit(1);
}
try {
  const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const j = await r.json();
  console.log("Telegram getMe:", j.ok === true ? `ok @${j.result?.username ?? "?"}` : JSON.stringify(j));
  if (!j.ok) ok = false;
} catch (e) {
  console.error("getMe failed:", e instanceof Error ? e.message : e);
  ok = false;
}

process.exit(ok ? 0 : 1);
