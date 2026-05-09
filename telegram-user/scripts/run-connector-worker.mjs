/**
 * Запуск connector/worker.py из корня telegram-user (одинаково на Windows/macOS/Linux).
 * Предусловия: connector/.venv, connector/.env, npm run dev на API_BASE_URL.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const connector = path.join(root, "connector");
const py =
  process.platform === "win32"
    ? path.join(connector, ".venv", "Scripts", "python.exe")
    : path.join(connector, ".venv", "bin", "python");

if (!fs.existsSync(py)) {
  console.error(
    "Нет connector/.venv. Выполните: cd connector && py -3 -m venv .venv && pip install -r requirements.txt",
  );
  process.exit(1);
}

const child = spawn(py, ["worker.py"], {
  cwd: connector,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 0));
