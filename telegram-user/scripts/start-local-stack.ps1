# Local deps: Postgres + gpt2giga (:8090). API and worker are separate processes.
$ErrorActionPreference = "Stop"
$telegramUserRoot = Split-Path $PSScriptRoot -Parent
Set-Location $telegramUserRoot
. (Join-Path $PSScriptRoot "load-dotenv.ps1") -Root $telegramUserRoot

Write-Host "docker compose: postgres..." -ForegroundColor Cyan
docker compose up -d postgres

Write-Host "prisma migrate deploy..." -ForegroundColor Cyan
npx prisma migrate deploy
npx prisma generate

Write-Host "gpt2giga (LLM proxy)..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "start-local-llm.ps1")

Write-Host ""
Write-Host "Done. Next in separate windows:" -ForegroundColor Green
Write-Host "  1) npm run dev (telegram-user) - API + product bot" -ForegroundColor White
Write-Host "  2) npm run worker  OR  .\\scripts\\start-worker.ps1 -NewWindow  - MTProto worker" -ForegroundColor White
Write-Host "     Health: GET http://127.0.0.1:4050/health -> worker.lastSeenAt" -ForegroundColor DarkGray
