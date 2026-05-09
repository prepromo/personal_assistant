# Проверка: API 4050, health, опционально PATCH policy (AGENT_API_TOKEN из .env).
# Запуск из каталога telegram-user:
#   .\scripts\smoke-stack.ps1
#   .\scripts\smoke-stack.ps1 -SetSuggest
#   .\scripts\smoke-stack.ps1 -AccountId "uuid" -SetManual

param(
    [switch]$SetSuggest,
    [switch]$SetManual,
    [string]$AccountId = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path $PSScriptRoot -Parent
. (Join-Path $here "scripts\load-dotenv.ps1") -Root $here

$port = if ($env:PORT) { $env:PORT } else { "4050" }
$base = "http://127.0.0.1:$port"
$token = $env:AGENT_API_TOKEN
if (-not $token) { throw "AGENT_API_TOKEN missing in .env" }

Write-Host "=== GET $base/health ===" -ForegroundColor Cyan
$h = Invoke-RestMethod -Uri "$base/health" -Method Get
$h | ConvertTo-Json -Compress
if (-not $h.ok) { throw "health not ok" }

if (-not $AccountId) {
    $lastFile = Join-Path $here ".last-account-id"
    if (Test-Path $lastFile) {
        $AccountId = (Get-Content $lastFile -Raw).Trim()
    }
}

if ($AccountId -and ($SetSuggest -or $SetManual)) {
    $mode = if ($SetManual) { "manual" } else { "suggest" }
    Write-Host "=== PATCH policy replyMode=$mode account=$AccountId ===" -ForegroundColor Cyan
    $body = @{ replyMode = $mode } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri "$base/v1/accounts/$AccountId/policy" -Method Patch `
        -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body $body
    $r | ConvertTo-Json -Compress
}

Write-Host ""
Write-Host "OK. Next: worker + connector (docs/USER-TURN.md). Cabinet: $base/cabinet.html" -ForegroundColor Green
