import "./env-bootstrap.js";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { logger } from "./lib/logger.js";
import authRoutes from "./routes/auth.routes.js";
import channelsRoutes from "./routes/channels.routes.js";
import inboxRoutes from "./routes/inbox.routes.js";
import agentsRoutes from "./routes/agents.routes.js";
import tasksRoutes from "./routes/tasks.routes.js";
import statsRoutes from "./routes/stats.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import { bootstrapTelegramIngest } from "./services/telegram-ingest.service.js";

const app = express();
/** Нужно для rate-limit при прокси Vite (иначе ERR_ERL_* из-за X-Forwarded-For). Не ставьте `true` — см. express-rate-limit. */
app.set("trust proxy", 1);
const port = Number(process.env.PORT) || 4000;

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "comrade-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/channels", channelsRoutes);
app.use("/api/inbox", inboxRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/billing", billingRoutes);

app.use((err, _req, res, _next) => {
  logger.error("unhandled", err);
  const dev = process.env.NODE_ENV !== "production";
  res.status(err.status || 500).json({
    error: dev ? err.message || "Internal server error" : "Internal server error",
  });
});

app.listen(port, () => {
  logger.info(`Comrade API listening on :${port}`);
  bootstrapTelegramIngest().catch((e) => logger.error("telegram ingest bootstrap", e));
});
