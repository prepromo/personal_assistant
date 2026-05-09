# Sends a test DM from the bot via Bot API (sendMessage). Does not use getUpdates — works even if gateway polling hits 409.
# Requires: chat_id of the user (from pairing allowlist or @userinfobot). Override: $env:TELEGRAM_TEST_CHAT_ID
$ErrorActionPreference = "Stop"
$openclawDir = Split-Path $PSScriptRoot -Parent
$projEnv = Join-Path $openclawDir ".env"
Get-Content $projEnv | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"')
        if ($k) { Set-Item -Path "env:$k" -Value $v }
    }
}
if (-not $env:TELEGRAM_BOT_TOKEN) { throw "TELEGRAM_BOT_TOKEN missing in openclaw/.env" }
$allow = Join-Path $env:USERPROFILE ".openclaw\credentials\telegram-default-allowFrom.json"
$chatId = $env:TELEGRAM_TEST_CHAT_ID
if (-not $chatId -and (Test-Path $allow)) {
    $j = Get-Content $allow -Raw | ConvertFrom-Json
    if ($j.allowFrom -and $j.allowFrom.Count -gt 0) { $chatId = [string]$j.allowFrom[0] }
}
if (-not $chatId) { throw "Set TELEGRAM_TEST_CHAT_ID or add user id to telegram-default-allowFrom.json" }
$base = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)"
$body = @{ chat_id = $chatId; text = "Привет (тест из send-telegram-test.ps1)" }
$r = Invoke-RestMethod -Uri "$base/sendMessage" -Method Post -Body $body
if (-not $r.ok) { throw ($r | ConvertTo-Json) }
Write-Host "OK: message_id=$($r.result.message_id) chat=$chatId"
