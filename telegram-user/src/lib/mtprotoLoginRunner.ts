import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Каталог `telegram-user/connector` (рядом с `src`). */
export const CONNECTOR_ROOT = path.resolve(__dirname, "../../connector");

function defaultConnectorPython(): string {
  const win = process.platform === "win32";
  const venvPy = win
    ? path.join(CONNECTOR_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(CONNECTOR_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venvPy)) return venvPy;
  return "python";
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

/** Подмешивает TELEGRAM_* из connector/.env, если в process.env ещё нет. */
function mergedEnv(): NodeJS.ProcessEnv {
  const connectorEnv = parseEnvFile(path.join(CONNECTOR_ROOT, ".env"));
  const next = { ...process.env, PYTHONUNBUFFERED: "1" } as NodeJS.ProcessEnv;
  for (const k of ["TELEGRAM_API_ID", "TELEGRAM_API_HASH"] as const) {
    const cur = String(next[k] ?? "").trim();
    if (!cur && connectorEnv[k]) next[k] = connectorEnv[k];
  }
  return next;
}

export type LoginWizardRequest =
  | { cmd: "send_code"; app_user_id: string; phone: string }
  | { cmd: "sign_in"; app_user_id: string; code: string }
  | { cmd: "password"; app_user_id: string; password: string };

export type LoginWizardResponse = Record<string, unknown>;

/**
 * Запускает `connector/login_wizard.py` (Pyrogram). Только на сервере с установленным Python + зависимостями коннектора.
 */
export function runLoginWizard(req: LoginWizardRequest): LoginWizardResponse {
  const py = process.env.PYTHON_PATH?.trim() || defaultConnectorPython();
  const script = path.join(CONNECTOR_ROOT, "login_wizard.py");
  if (!fs.existsSync(script)) {
    return { ok: false, error: "login_wizard.py_not_found" };
  }
  const payload = JSON.stringify(req);
  const r = spawnSync(py, [script], {
    cwd: CONNECTOR_ROOT,
    input: payload,
    encoding: "utf-8",
    env: mergedEnv(),
    maxBuffer: 12 * 1024 * 1024,
  });
  const errText = (r.stderr || "").trim();
  const outText = (r.stdout || "").trim();
  if (r.error) {
    return { ok: false, error: `spawn:${String((r.error as Error).message)}` };
  }
  if (r.status !== 0 && !outText) {
    return { ok: false, error: errText || `exit_${r.status}` };
  }
  try {
    const parsed = JSON.parse(outText) as LoginWizardResponse;
    if (parsed.ok !== true) {
      console.warn(
        "[login_wizard]",
        req.cmd,
        req.app_user_id.slice(0, 48),
        "error:",
        String(parsed.error ?? ""),
        errText ? `stderr:${errText.slice(0, 400)}` : "",
      );
    }
    return parsed;
  } catch {
    console.warn("[login_wizard] bad_json stdout:", outText.slice(0, 500), "stderr:", errText.slice(0, 400));
    return { ok: false, error: "bad_json_from_wizard", raw: outText.slice(0, 500), stderr: errText.slice(0, 500) };
  }
}
