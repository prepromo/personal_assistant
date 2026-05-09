# One command: gpt2giga (GigaChat) from openclaw/.env + local SaaS portal.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$openclaw = Join-Path $root "openclaw"
$gptScript = Join-Path $openclaw "scripts\start-gpt2giga.ps1"
if (-not (Test-Path $gptScript)) {
    Write-Error "Missing: $gptScript"
}

Write-Host "=== 1/2 gpt2giga (OpenAI-compatible -> GigaChat) ===" -ForegroundColor Cyan
& $gptScript

$saas = Join-Path $root "local-saas"
$envFile = Join-Path $saas ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "Copy local-saas/.env.example -> .env" -ForegroundColor Yellow
    Copy-Item (Join-Path $saas ".env.example") $envFile
}

Set-Location $saas
if (-not (Test-Path "node_modules")) {
    Write-Host "npm install in local-saas..." -ForegroundColor Cyan
    npm install
}

Write-Host ""
Write-Host "=== 2/2 Local SaaS portal (login, mock plans, chat) ===" -ForegroundColor Cyan
Write-Host "Open in browser: http://127.0.0.1:3090/" -ForegroundColor Green
node server.mjs
