import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { webhookCallback } from "grammy";
import internalRoutes from "./routes/internal.js";
import agentRoutes from "./routes/agent.js";
import v1ProductRoutes from "./routes/v1Product.js";
import v1TelegramBindingsRoutes from "./routes/v1TelegramBindings.js";
import authCabinetRoutes from "./routes/authCabinet.js";
import oidcAuthRoutes from "./routes/oidcAuth.js";
import webCabinetRoutes from "./routes/webCabinet.js";
import chatCabinetRoutes from "./routes/chatCabinet.js";
import mtprotoCabinetRoutes from "./routes/mtprotoCabinet.js";
import billingCabinetRoutes from "./routes/billingCabinet.js";
import { prisma } from "./lib/prisma.js";
import { startReminderScheduler } from "./lib/reminderScheduler.js";
import { startNewsDigestScheduler } from "./lib/newsDigest.js";
import { createProductBot, isProductBotConfigured } from "./bot/productBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const landingIndexHtml = path.join(publicDir, "index.html");
const app = express();
const port = Number(process.env.PORT) || 4050;

const corsList = process.env.CORS_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const defaultDevOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
app.use(
  cors({
    origin(origin, cb) {
      if (process.env.CORS_ORIGINS === "*") {
        cb(null, true);
        return;
      }
      if (!origin) {
        cb(null, true);
        return;
      }
      const allow = corsList && corsList.length > 0 ? corsList : defaultDevOrigins;
      if (allow.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "4mb" }));

app.get("/health", async (_req, res) => {
  let workerLast: string | null = null;
  try {
    const p = await prisma.workerPing.findUnique({ where: { id: "singleton" } });
    workerLast = p?.lastSeenAt?.toISOString() ?? null;
  } catch {
    workerLast = null;
  }
  const botMode = (process.env.BOT_MODE || "polling").trim();
  const llmOk = Boolean(
    (process.env.OPENCLAW_GATEWAY_URL?.trim() && process.env.OPENCLAW_GATEWAY_TOKEN?.trim()) ||
      (process.env.OPENAI_BASE_URL?.trim() && process.env.OPENAI_API_KEY?.trim()) ||
      (process.env.CABINET_OPENAI_BASE_URL?.trim() && process.env.CABINET_OPENAI_API_KEY?.trim()),
  );
  res.json({
    ok: true,
    service: "telegram-user-api",
    worker: { lastSeenAt: workerLast },
    productBot: {
      configured: isProductBotConfigured(),
      mode: isProductBotConfigured() ? botMode : null,
    },
    llm: { configured: llmOk },
  });
});

/** Корень: официальный лендинг (prepromo → public/index.html), иначе старый выбор /start.html */
app.get("/", (_req, res) => {
  if (existsSync(landingIndexHtml)) {
    res.sendFile(landingIndexHtml);
    return;
  }
  res.redirect(302, "/start.html");
});

app.use(express.static(publicDir));
app.use("/docs", express.static(path.join(__dirname, "../docs")));

app.use("/internal", internalRoutes);
app.use("/v1", agentRoutes);
app.use("/v1", v1ProductRoutes);
app.use("/v1", v1TelegramBindingsRoutes);
app.use("/api/v1/auth", authCabinetRoutes);
app.use("/api/v1/auth", oidcAuthRoutes);
app.use("/api/v1/cabinet", billingCabinetRoutes);
app.use("/api/v1/cabinet", webCabinetRoutes);
app.use("/api/v1/cabinet", chatCabinetRoutes);
app.use("/api/v1/cabinet", mtprotoCabinetRoutes);

const productBotToken = process.env.PRODUCT_BOT_TOKEN?.trim();
const botMode = (process.env.BOT_MODE || "polling").trim();
let productBot: ReturnType<typeof createProductBot> | null = null;
if (productBotToken) {
  productBot = createProductBot(productBotToken);
  if (botMode === "webhook") {
    const secret = process.env.PRODUCT_BOT_WEBHOOK_SECRET?.trim();
    app.post(
      "/api/v1/bot/webhook",
      webhookCallback(productBot, "express", {
        secretToken: secret || undefined,
      }),
    );
  }
}

function isDatabaseUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  return (
    name === "PrismaClientInitializationError" ||
    msg.includes("Can't reach database server") ||
    msg.includes("P1001")
  );
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (isDatabaseUnavailable(err)) {
    res.status(503).json({
      error: "База данных недоступна",
      detail:
        "Запустите Docker Desktop, затем в каталоге telegram-user: docker compose up -d postgres и npx prisma migrate deploy",
    });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
});

app.listen(port, () => {
  console.log(`telegram-user API http://127.0.0.1:${port}`);
  console.log(`Start (MVP / кабинет) http://127.0.0.1:${port}/`);
  console.log(`Cabinet UI http://127.0.0.1:${port}/cabinet.html`);
  console.log(`Connect (MTProto) http://127.0.0.1:${port}/connect.html`);
  console.log(`MVP debug UI http://127.0.0.1:${port}/mvp.html`);
  if (productBot && botMode === "polling") {
    void productBot.start({
      onStart: (b) => console.log(`Product bot @${b.username} — getUpdates (polling)`),
    });
  } else if (productBotToken && botMode === "webhook") {
    console.log(`Product bot webhook POST http://127.0.0.1:${port}/api/v1/bot/webhook`);
  } else if (!productBotToken) {
    console.log("Product bot: выключен (нет PRODUCT_BOT_TOKEN)");
  }
  startReminderScheduler();
  if (process.env.NEWS_DIGEST_ENABLED === "1") {
    const newsDigestMs = Math.max(60_000, Number(process.env.NEWS_DIGEST_POLL_MS) || 900_000);
    startNewsDigestScheduler(newsDigestMs);
    console.log(`News digest scheduler every ${newsDigestMs}ms ([newsDigest])`);
  } else {
    console.log("News digest scheduler: off (set NEWS_DIGEST_ENABLED=1 to enable)");
  }
});
