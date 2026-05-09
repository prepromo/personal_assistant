# Unified stack launcher (PowerShell-safe).
# Desktop mode opens separate PowerShell windows (recommended).
# Here mode runs the Node runner `scripts/tg-stack.mjs` (concurrently) in this terminal.

param(
  [switch]$NoWorker,
  [switch]$DesktopWindows,
  [switch]$SkipPostgres
)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$openclaw = Join-Path $repo "openclaw"
$tu = Join-Path $repo "telegram-user"

$gatewayScript = Join-Path $openclaw "scripts\\start-gateway.ps1"
$workerScript = Join-Path $tu "scripts\\start-worker.ps1"
$depsScript = Join-Path $tu "scripts\\start-local-stack.ps1"

if (-not (Test-Path $gatewayScript)) { throw "Missing: $gatewayScript" }
if (-not (Test-Path $depsScript)) { throw "Missing: $depsScript" }
if (-not (Test-Path (Join-Path $tu "package.json"))) { throw "Missing telegram-user directory: $tu" }

Write-Host ""
Write-Host "=== TG stack ===" -ForegroundColor Cyan

if ($DesktopWindows) {
  # Deps (postgres + prisma + gpt2giga)
  if (-not $SkipPostgres) {
    & $depsScript
  }

  # Gateway (starts gpt2giga too, but harmless if already running)
  Start-Process powershell -ArgumentList @("-NoExit","-NoProfile","-ExecutionPolicy","Bypass","-File",$gatewayScript)

  # API + product bot
  Start-Process powershell -ArgumentList @(
    "-NoExit","-NoProfile","-ExecutionPolicy","Bypass",
    "-Command", ('Set-Location -LiteralPath "{0}"; npm run dev' -f $tu)
  )

  # Worker
  if (-not $NoWorker) {
    Start-Process powershell -ArgumentList @("-NoExit","-NoProfile","-ExecutionPolicy","Bypass","-File",$workerScript,"-NewWindow")
  }

  Write-Host "Started (desktop windows)." -ForegroundColor Green
  return
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node not found. Install Node.js or use -DesktopWindows."
}

$runner = Join-Path $repo "scripts\\tg-stack.mjs"
if (-not (Test-Path $runner)) { throw "Missing runner: $runner" }

$nodeArgs = @($runner)
if ($NoWorker) { $nodeArgs += "--no-worker" }
if ($SkipPostgres) { $nodeArgs += "--skip-postgres" }

Push-Location $repo
try { & node @nodeArgs }
finally { Pop-Location }
