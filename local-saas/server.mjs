import "dotenv/config";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import session from "express-session";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");

const PORT = Number(process.env.PORT) || 3090;
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-only-change-in-env";
const LLM_BASE = (process.env.LLM_OPENAI_BASE_URL || "http://127.0.0.1:8090/v1").replace(/\/$/, "");
const LLM_KEY = process.env.LLM_API_KEY || "sk-local-saas-dev";
const GW_BASE = process.env.OPENCLAW_GATEWAY_URL?.replace(/\/$/, "") || "";
const GW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const GW_MODEL = process.env.OPENCLAW_CHAT_MODEL || "openclaw/default";
const TELEGRAM_USER_HEALTH =
  (process.env.TELEGRAM_USER_HEALTH_URL || "http://127.0.0.1:4050/health").replace(/\/$/, "");

/** No login: default on. Set LOCAL_SAAS_SKIP_AUTH=0 in .env to require login again. */
const SKIP_AUTH =
  process.env.LOCAL_SAAS_SKIP_AUTH !== "0" && process.env.LOCAL_SAAS_SKIP_AUTH !== "false";

function loadStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersFile)) return { users: [] };
  try {
    return JSON.parse(fs.readFileSync(usersFile, "utf8"));
  } catch {
    return { users: [] };
  }
}

function saveStore(store) {
  fs.writeFileSync(usersFile, JSON.stringify(store, null, 2), "utf8");
}

function findUserByEmail(email) {
  const s = loadStore();
  return s.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: "lax" },
  }),
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (SKIP_AUTH) return next();
  if (!req.session.userId) {
    return res.status(401).json({ error: "Требуется вход" });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "local-saas-portal",
    llmBase: LLM_BASE,
    openclawGateway: Boolean(GW_BASE && GW_TOKEN),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    skipAuth: SKIP_AUTH,
    llm: { baseUrl: LLM_BASE, label: "gpt2giga → GigaChat" },
    openclaw: GW_BASE && GW_TOKEN
      ? { url: GW_BASE, model: GW_MODEL, label: "OpenClaw gateway" }
      : null,
    links: {
      openclawDocs: "https://docs.openclaw.ai",
      telegramUser: "http://127.0.0.1:4050/",
    },
  });
});

app.get("/api/models", async (_req, res) => {
  try {
    const r = await fetch(`${LLM_BASE}/models`, {
      headers: { Authorization: `Bearer ${LLM_KEY}` },
    });
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    res.status(502).json({
      error: "models_unavailable",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

async function probeFetch(url, init = {}) {
  try {
    const r = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(3500),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Сводка для status.html / отладки */
app.get("/api/status", async (_req, res) => {
  const gpt2giga = await probeFetch(`${LLM_BASE}/models`, {
    headers: { Authorization: `Bearer ${LLM_KEY}` },
  });
  const telegramUser = await probeFetch(TELEGRAM_USER_HEALTH);

  let openclawProbe = { configured: false };
  if (GW_BASE && GW_TOKEN) {
    const root = await probeFetch(GW_BASE);
    openclawProbe = {
      configured: true,
      url: GW_BASE,
      http: root,
    };
  }

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    localSaas: { port: PORT, skipAuth: SKIP_AUTH },
    gpt2giga: {
      base: LLM_BASE,
      ...gpt2giga,
    },
    openclawGateway: openclawProbe,
    telegramUser: {
      optional: true,
      healthUrl: TELEGRAM_USER_HEALTH,
      ...telegramUser,
    },
  });
});

app.get("/api/me", (req, res) => {
  if (SKIP_AUTH) {
    return res.json({
      user: { id: "guest", email: "guest@local", plan: "free" },
      skipAuth: true,
    });
  }
  if (!req.session.userId) {
    return res.json({ user: null, skipAuth: false });
  }
  const s = loadStore();
  const u = s.users.find((x) => x.id === req.session.userId);
  if (!u) return res.json({ user: null, skipAuth: false });
  res.json({
    user: { id: u.id, email: u.email, plan: u.plan || "free", createdAt: u.createdAt },
    skipAuth: false,
  });
});

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  if (!email.includes("@") || password.length < 6) {
    return res.status(400).json({ error: "Email и пароль ≥ 6 символов" });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: "Пользователь уже есть" });
  }
  const hash = await bcrypt.hash(password, 10);
  const id = randomUUID();
  const store = loadStore();
  store.users.push({
    id,
    email,
    passwordHash: hash,
    plan: "free",
    createdAt: new Date().toISOString(),
  });
  saveStore(store);
  req.session.userId = id;
  res.json({ ok: true, user: { id, email, plan: "free" } });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const u = findUserByEmail(email);
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
    return res.status(401).json({ error: "Неверный email или пароль" });
  }
  req.session.userId = u.id;
  res.json({ ok: true, user: { id: u.id, email: u.email, plan: u.plan || "free" } });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const messages = req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Нужен массив messages" });
  }
  const provider = String(req.body.provider || "gpt2giga");
  const temperature = typeof req.body.temperature === "number" ? req.body.temperature : 0.7;

  try {
    if (provider === "openclaw") {
      if (!GW_BASE || !GW_TOKEN) {
        return res.status(400).json({
          error:
            "OpenClaw gateway not configured: set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN in local-saas/.env",
        });
      }
      const model = String(req.body.model || GW_MODEL);
      const r = await fetch(`${GW_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GW_TOKEN}`,
        },
        body: JSON.stringify({ model, messages, temperature }),
      });
      const text = await r.text();
      res.status(r.status).type("application/json").send(text);
      return;
    }

    const model = String(req.body.model || "GigaChat");
    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
    });
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    res.status(502).json({
      error: "chat_upstream_failed",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Landing            http://127.0.0.1:${PORT}/`);
  console.log(`  Status dashboard   http://127.0.0.1:${PORT}/status.html`);
  console.log(`  Dashboard          http://127.0.0.1:${PORT}/dashboard.html`);
  console.log(`  LLM (gpt2giga)     ${LLM_BASE}`);
  console.log(`  OpenClaw GW        ${GW_BASE && GW_TOKEN ? GW_BASE : "(not set)"}`);
  console.log(`  Auth               ${SKIP_AUTH ? "OFF\n" : "ON\n"}`);
});
