/**
 * Runs gateway + telegram-user API + worker in one terminal via concurrently (programmatic API).
 * Invoked by start-tg-stack.ps1 (not meant to be run directly unless from repo root).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { concurrently } from "concurrently";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");
const noWorker = process.argv.includes("--no-worker");

/** Escape for PowerShell single-quoted string */
function escSq(p) {
  return p.replace(/'/g, "''");
}

const gatewayScript = path.join(repo, "openclaw", "scripts", "start-gateway.ps1");
const tu = path.join(repo, "telegram-user");
const workerScript = path.join(repo, "telegram-user", "scripts", "start-worker.ps1");

const commands = [
  {
    command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${gatewayScript}"`,
    name: "gateway",
    prefixColor: "cyan",
  },
  {
    command: `powershell.exe -NoProfile -Command "Start-Sleep -Seconds 15; Set-Location -LiteralPath '${escSq(tu)}'; npm run dev"`,
    name: "api",
    prefixColor: "green",
  },
];

if (!noWorker) {
  commands.push({
    command: `powershell.exe -NoProfile -Command "Start-Sleep -Seconds 22; & '${escSq(workerScript)}'"`,
    name: "worker",
    prefixColor: "yellow",
  });
}

const { result } = concurrently(commands, {
  prefixColors: commands.map((c) => c.prefixColor),
});

result
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
