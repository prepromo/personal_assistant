# Создаёт/обновляет привязку Telegram user id -> appUserId (PUT /v1/telegram-bindings/:id).
# Переменные: TELEGRAM_USER_ID, APP_USER_ID; токен из openclaw/.env или TELEGRAM_USER_AGENT_TOKEN.
# Узнать Telegram id: openclaw logs --follow (from.id в личке с ботом).
param(
    [string]$TelegramUserId = $env:TELEGRAM_USER_ID,
    [string]$AppUserId = $env:APP_USER_ID
)
$ErrorActionPreference = "Stop"
$openclawDir = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $openclawDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
        $pair = $_ -split '=', 2
        if ($pair.Count -eq 2) {
            $k = $pair[0].Trim()
            $v = $pair[1].Trim().Trim('"')
            if ($k -and $v) { Set-Item -Path "env:$k" -Value $v }
        }
    }
}
if (-not $TelegramUserId -or -not $AppUserId) {
    throw "Задайте TELEGRAM_USER_ID и APP_USER_ID (или -TelegramUserId -AppUserId)."
}
$base = if ($env:TELEGRAM_USER_BASE_URL) { $env:TELEGRAM_USER_BASE_URL.TrimEnd('/') } else { "http://127.0.0.1:4050" }
$token = $env:TELEGRAM_USER_AGENT_TOKEN
if (-not $token) { throw "TELEGRAM_USER_AGENT_TOKEN не задан (в openclaw/.env или env)" }
$H = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$body = '{"appUserId":"' + ($AppUserId -replace '"', '\"') + '"}'
$r = Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$TelegramUserId" -Method Put -Headers $H -Body $body
Write-Host ($r | ConvertTo-Json -Compress)
