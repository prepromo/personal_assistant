# Смоук invoke.ps1 (как у агента через exec): привязка → resolve → tasks-create → удаление привязки.
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
if (-not $env:TELEGRAM_USER_AGENT_TOKEN) {
    $env:TELEGRAM_USER_AGENT_TOKEN = "local-dev-agent-token-2026"
}
$invoke = Join-Path $openclawDir "skills\telegram-user\invoke.ps1"
if (-not (Test-Path $invoke)) { throw "Не найден: $invoke" }

$tg = "888777666"
$app = "smoke-invoke-user-1"
$base = if ($env:TELEGRAM_USER_BASE_URL) { $env:TELEGRAM_USER_BASE_URL.TrimEnd('/') } else { "http://127.0.0.1:4050" }
$H = @{ Authorization = "Bearer $($env:TELEGRAM_USER_AGENT_TOKEN)"; "Content-Type" = "application/json" }
Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$tg" -Method Put -Headers $H -Body "{`"appUserId`":`"$app`"}" | Out-Null

$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell.exe" }
$out = & $shell -NoProfile -ExecutionPolicy Bypass -File $invoke -Action resolve -TelegramUserId $tg
Write-Host "invoke resolve:" $out
if ($out -notmatch $app) { throw "resolve: ожидался appUserId $app" }

$out2 = & $shell -NoProfile -ExecutionPolicy Bypass -File $invoke -Action tasks-create -AppUserId $app -Title "smoke task" -Body "invoke.ps1"
Write-Host "invoke tasks-create:" $out2
if ($out2 -notmatch "smoke task") { throw "tasks-create: нет title в ответе" }

Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$tg" -Method Delete -Headers @{ Authorization = "Bearer $($env:TELEGRAM_USER_AGENT_TOKEN)" } | Out-Null
Write-Host "OK: test-telegram-user-invoke"
