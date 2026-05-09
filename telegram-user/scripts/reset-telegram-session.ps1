# Сбрасывает сессию в БД (после ошибочного входа ботом). Удалите вручную connector/sessions/*.session*
param([string]$AppUserId = "")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "load-dotenv.ps1") -Root $root

if (-not $AppUserId) {
    $conn = Join-Path $root "connector\.env"
    if (-not (Test-Path $conn)) { throw "Missing $conn" }
    Get-Content $conn | ForEach-Object {
        if ($_ -match '^\s*APP_USER_ID=(.*)$') { $AppUserId = $matches[1].Trim() }
    }
}
if (-not $AppUserId) { throw "Укажите AppUserId или задайте APP_USER_ID в connector/.env" }

$port = if ($env:PORT) { $env:PORT } else { "4050" }
$secret = $env:CONNECTOR_SECRET
if (-not $secret) { throw "CONNECTOR_SECRET в telegram-user/.env" }

$uri = "http://127.0.0.1:$port/internal/reset-session"
$body = @{ appUserId = $AppUserId } | ConvertTo-Json -Compress
try {
    $r = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json; charset=utf-8" `
        -Headers @{ "X-Connector-Secret" = $secret }
    Write-Host "OK:" -ForegroundColor Green
    $r | ConvertTo-Json
    Write-Host "Удалите файлы в connector/sessions (кроме .gitkeep если есть), затем снова .\scripts\run-telegram.ps1" -ForegroundColor DarkGray
} catch {
    Write-Host "API недоступен? Запустите npm run dev в telegram-user." -ForegroundColor Red
    throw
}
