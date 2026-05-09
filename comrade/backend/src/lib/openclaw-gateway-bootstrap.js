/**
 * Если OPENCLAW_GATEWAY_TOKEN не задан в .env — подставляет из профиля OpenClaw:
 * %USERPROFILE%\.openclaw\.env и %USERPROFILE%\.openclaw\openclaw.json (gateway.auth.token).
 */
import dotenv from "dotenv";
import { readFileSync, existsSync } from "fs";
import path from "path";
import os from "os";
import JSON5 from "json5";

function loadUserOpenclawDotenv() {
  const p = path.join(os.homedir(), ".openclaw", ".env");
  if (!existsSync(p)) return {};
  try {
    return dotenv.parse(readFileSync(p));
  } catch {
    return {};
  }
}

function expandEnvRef(value, userEnv) {
  if (typeof value !== "string") return null;
  const m = value.match(/^\$\{([^}]+)\}$/);
  if (!m) return value.trim() || null;
  const name = m[1];
  return (
    process.env[name]?.trim() ||
    userEnv[name]?.trim() ||
    null
  );
}

/**
 * @returns {string|null}
 */
function readTokenFromOpenclawJson(userEnv) {
  const jsonPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (!existsSync(jsonPath)) return null;
  let data;
  try {
    data = JSON5.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return null;
  }
  const auth = data?.gateway?.auth;
  if (!auth || auth.mode === "password" || auth.mode === "none") return null;
  const raw = auth.token;
  if (raw == null || raw === "") return null;
  return expandEnvRef(String(raw), userEnv);
}

export function applyOpenClawGatewayFromUserProfile() {
  const userEnv = loadUserOpenclawDotenv();

  if (!process.env.OPENCLAW_GATEWAY_TOKEN?.trim()) {
    const fromUserDotenv = userEnv.OPENCLAW_GATEWAY_TOKEN?.trim();
    if (fromUserDotenv) {
      process.env.OPENCLAW_GATEWAY_TOKEN = fromUserDotenv;
    }
  }

  if (!process.env.OPENCLAW_GATEWAY_TOKEN?.trim()) {
    const fromJson = readTokenFromOpenclawJson(userEnv);
    if (fromJson) {
      process.env.OPENCLAW_GATEWAY_TOKEN = fromJson;
    }
  }

  if (!process.env.OPENCLAW_GATEWAY_URL?.trim()) {
    const jsonPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    if (existsSync(jsonPath)) {
      try {
        const data = JSON5.parse(readFileSync(jsonPath, "utf8"));
        const port = data?.gateway?.port;
        if (typeof port === "number" && Number.isFinite(port)) {
          process.env.OPENCLAW_GATEWAY_URL = `http://127.0.0.1:${port}`;
        }
      } catch {
        /* ignore */
      }
    }
  }
}
