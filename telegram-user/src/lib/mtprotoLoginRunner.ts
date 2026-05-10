import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { once } from "node:events";
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

/** Совпадает с `_safe_app_id` в `login_wizard.py`. */
export function safeWizardFsId(appUserId: string): string {
  return appUserId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function wizardMetaDir(appUserId: string): string {
  return path.join(CONNECTOR_ROOT, "sessions", "wizard_ipc", safeWizardFsId(appUserId));
}

function cleanupWizardMetaFiles(appUserId: string): void {
  const dir = wizardMetaDir(appUserId);
  for (const f of ["port.txt", "pid.txt", "spawn.lock"]) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

export type LoginWizardRequest =
  | { cmd: "send_code"; app_user_id: string; phone: string; force_resend?: boolean }
  | { cmd: "sign_in"; app_user_id: string; code: string }
  | { cmd: "password"; app_user_id: string; password: string };

export type LoginWizardResponse = Record<string, unknown>;

type WizardTcpSession = {
  sock: net.Socket;
  rl: readline.Interface;
  spawnedProc: ChildProcess | null;
};

const tcpSessions = new Map<string, WizardTcpSession>();

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - t0 > timeoutMs) throw new Error("wizard_tcp_wait_timeout");
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function writeWizardLine(sock: net.Socket, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const payload = Buffer.from(line, "utf8");
    sock.write(payload, (err) => (err ? reject(err) : resolve()));
  });
}

async function readWizardLine(rl: readline.Interface): Promise<string> {
  return new Promise((resolve, reject) => {
    const onLine = (line: string) => {
      cleanup();
      resolve(line);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("wizard_tcp_closed"));
    };
    function cleanup() {
      rl.off("line", onLine);
      rl.off("close", onClose);
    }
    rl.once("line", onLine);
    rl.once("close", onClose);
  });
}

async function rpcOnSession(s: WizardTcpSession, req: object): Promise<LoginWizardResponse> {
  const payload = `${JSON.stringify(req)}\n`;
  const linePromise = readWizardLine(s.rl);
  await writeWizardLine(s.sock, payload);
  const line = await linePromise;
  try {
    return JSON.parse(line) as LoginWizardResponse;
  } catch {
    return { ok: false, error: "bad_json_from_wizard_tcp", raw: line.slice(0, 500) };
  }
}

async function tryOpenWizardSession(appUserId: string, port: number): Promise<WizardTcpSession> {
  const sock = net.createConnection({ port, host: "127.0.0.1", family: 4 });
  sock.setEncoding("utf8");
  await once(sock, "connect");
  const rl = readline.createInterface({ input: sock });
  const s: WizardTcpSession = { sock, rl, spawnedProc: null };
  const ping = await rpcOnSession(s, { cmd: "ping", app_user_id: appUserId });
  if (ping.ok !== true || ping.pong !== true) {
    rl.close();
    sock.destroy();
    throw new Error(String(ping.error || "wizard_tcp_ping_failed"));
  }
  return s;
}

async function connectOrSpawnWizardTcp(appUserId: string): Promise<WizardTcpSession> {
  const dir = wizardMetaDir(appUserId);
  fs.mkdirSync(dir, { recursive: true });
  const portPath = path.join(dir, "port.txt");
  const lockPath = path.join(dir, "spawn.lock");

  const readPort = (): number | null => {
    if (!fs.existsSync(portPath)) return null;
    const n = Number(String(fs.readFileSync(portPath, "utf8")).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  let port = readPort();
  if (port !== null) {
    try {
      return await tryOpenWizardSession(appUserId, port);
    } catch {
      try {
        fs.unlinkSync(portPath);
      } catch {
        /* ignore */
      }
    }
  }

  let lockFd: number | undefined;
  try {
    lockFd = fs.openSync(lockPath, "wx");
  } catch {
    await waitForFile(portPath, 20000);
    port = readPort();
    if (port === null) throw new Error("wizard_tcp_no_port_after_wait");
    return await tryOpenWizardSession(appUserId, port);
  }

  let spawnedProc: ChildProcess | null = null;
  try {
    const py = process.env.PYTHON_PATH?.trim() || defaultConnectorPython();
    const script = path.join(CONNECTOR_ROOT, "login_wizard.py");
    if (!fs.existsSync(script)) throw new Error("login_wizard.py_not_found");

    spawnedProc = spawn(py, ["-u", script, "--ipc-tcp", appUserId], {
      cwd: CONNECTOR_ROOT,
      env: mergedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    spawnedProc.stderr?.on("data", (c: Buffer | string) => {
      const t = (typeof c === "string" ? c : c.toString("utf8")).trimEnd();
      if (t) console.warn("[login_wizard_tcp stderr]", appUserId.slice(0, 48), t.slice(0, 400));
    });

    await waitForFile(portPath, 25000);
    port = readPort();
    if (port === null) throw new Error("wizard_tcp_spawn_missing_port");
    const s = await tryOpenWizardSession(appUserId, port);
    s.spawnedProc = spawnedProc;
    spawnedProc = null;
    return s;
  } catch (e) {
    spawnedProc?.kill();
    throw e;
  } finally {
    if (lockFd !== undefined) {
      try {
        fs.closeSync(lockFd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

async function ensureWizardTcpSession(appUserId: string): Promise<WizardTcpSession> {
  const cached = tcpSessions.get(appUserId);
  if (cached && !cached.sock.destroyed && cached.sock.writable) {
    try {
      const ping = await rpcOnSession(cached, { cmd: "ping", app_user_id: appUserId });
      if (ping.ok === true && ping.pong === true) return cached;
    } catch {
      /* stale */
    }
    tcpSessions.delete(appUserId);
    try {
      cached.rl.close();
    } catch {
      /* ignore */
    }
    try {
      cached.sock.destroy();
    } catch {
      /* ignore */
    }
  }

  const s = await connectOrSpawnWizardTcp(appUserId);
  tcpSessions.set(appUserId, s);
  return s;
}

/** Закрыть TCP-мост мастера входа (любой инстанс Node может вызвать). */
export async function disposeLoginWizardWorker(appUserId: string): Promise<void> {
  const s = tcpSessions.get(appUserId);
  tcpSessions.delete(appUserId);

  if (s) {
    try {
      await writeWizardLine(s.sock, `${JSON.stringify({ cmd: "shutdown", app_user_id: appUserId })}\n`);
      await Promise.race([
        readWizardLine(s.rl),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error("shutdown_timeout")), 4000)),
      ]);
    } catch {
      try {
        s.spawnedProc?.kill();
      } catch {
        /* ignore */
      }
    }
    try {
      s.rl.close();
    } catch {
      /* ignore */
    }
    try {
      s.sock.destroy();
    } catch {
      /* ignore */
    }
    try {
      s.spawnedProc?.kill();
    } catch {
      /* ignore */
    }
  }

  cleanupWizardMetaFiles(appUserId);
}

/**
 * JSON-RPC по строкам через localhost TCP: один процесс Python на appUserId,
 * общий для нескольких worker Node и держащий Pyrogram Client между шагами.
 */
export async function runLoginWizardAsync(req: LoginWizardRequest): Promise<LoginWizardResponse> {
  const session = await ensureWizardTcpSession(req.app_user_id);
  return rpcOnSession(session, req);
}
