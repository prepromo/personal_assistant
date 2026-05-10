/**
 * Проверка переменных биллинга и доступности API ЮKassa (без вывода секретов).
 * Запуск: cd telegram-user && npm run verify:billing
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function mask(s) {
  if (!s) return "(нет)";
  const t = String(s).trim();
  if (t.length <= 4) return "****";
  return "*".repeat(Math.min(t.length - 4, 12)) + t.slice(-4);
}

/** Ломаем exit только если ЮKassa настроена, но ключи не проходят. */
let yookassaOk = true;
let warned = false;

const cab = process.env.CABINET_PUBLIC_URL?.trim() || process.env.PRODUCT_PUBLIC_BASE_URL?.trim();
console.log("CABINET_PUBLIC_URL / PRODUCT_PUBLIC_BASE_URL:", cab || "(не задан — return_url после оплаты может быть относительным)");
console.log("BILLING_ALLOW_SIMULATED_PAYMENT:", process.env.BILLING_ALLOW_SIMULATED_PAYMENT === "1" ? "1 (вкл)" : "(выкл)");
console.log("YOOKASSA_TEST_PAYMENTS:", process.env.YOOKASSA_TEST_PAYMENTS?.trim() || "(выкл — боевые платежи без test:true)");

const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
const secret = process.env.YOOKASSA_SECRET_KEY?.trim();
console.log("YOOKASSA_SHOP_ID:", shopId ? `${mask(shopId)} (len ${shopId.length})` : "(нет)");
console.log("YOOKASSA_SECRET_KEY:", secret ? `задан (${secret.length} симв.)` : "(нет)");

if (shopId && secret) {
  const auth = Buffer.from(`${shopId}:${secret}`, "utf8").toString("base64");
  try {
    const r = await fetch("https://api.yookassa.ru/v3/payments?limit=1", {
      headers: { Authorization: `Basic ${auth}` },
    });
    const snippet = (await r.text()).slice(0, 200);
    console.log("ЮKassa GET /v3/payments?limit=1 → HTTP", r.status);
    if (!r.ok) {
      console.error("Ответ:", snippet);
      yookassaOk = false;
    }
  } catch (e) {
    console.error("Запрос к ЮKassa не выполнен:", e instanceof Error ? e.message : e);
    yookassaOk = false;
  }
} else {
  console.log("Проверка ЮKassa пропущена (нет shopId или secret).");
}

const db = process.env.DATABASE_URL?.trim();
if (db) {
  try {
    const out = execSync("npx prisma migrate status", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("\n--- prisma migrate status ---\n" + out.trim());
  } catch (e) {
    warned = true;
    console.warn("\nprisma migrate status (предупреждение):", e.stderr?.toString?.().trim() || e.message);
    console.warn("Поднимите Postgres или выполните на сервере: npx prisma migrate deploy");
  }
} else {
  console.log("\nDATABASE_URL не задан — prisma migrate status пропущен.");
}

const port = Number(process.env.PORT) || 4050;
try {
  const h = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  const j = await h.json().catch(() => ({}));
  console.log("\nGET /health:", h.ok ? JSON.stringify(j) : h.status);
  if (!h.ok || !j.ok) {
    warned = true;
    console.warn("\nGET /health: неожиданный ответ");
  }
} catch {
  warned = true;
  console.warn("\nGET /health: API не отвечает на", port, "(запустите npm run start / dev)");
}

if (!yookassaOk) {
  console.error("\nverify:billing — ошибка проверки ЮKassa.");
  process.exit(1);
}
console.log(
  warned
    ? "\nverify:billing — ЮKassa ок; есть предупреждения (БД или локальный API)."
    : "\nverify:billing — все проверки прошли.",
);
process.exit(0);
