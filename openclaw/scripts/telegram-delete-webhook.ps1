# Removes Telegram webhook so long polling (OpenClaw) is not blocked. Reads openclaw/.env.
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
$base = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)"
$r = Invoke-RestMethod -Uri "$base/deleteWebhook?drop_pending_updates=false" -Method Post
if (-not $r.ok) { throw "deleteWebhook failed: $($r | ConvertTo-Json -Compress)" }
Write-Host "OK: Telegram webhook cleared (polling allowed)."
