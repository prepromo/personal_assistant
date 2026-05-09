# Проверка health и привязки telegram-user (нужен запущенный API: npm run dev в telegram-user).
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
$base = if ($env:TELEGRAM_USER_BASE_URL) { $env:TELEGRAM_USER_BASE_URL.TrimEnd('/') } else { "http://127.0.0.1:4050" }
$token = $env:TELEGRAM_USER_AGENT_TOKEN
if (-not $token) { $token = "local-dev-agent-token-2026" }
$H = @{ Authorization = "Bearer $token" }

$hResp = Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 10
Write-Host "health:" ($hResp | ConvertTo-Json -Compress)

$testTg = "999888777"
$body = '{"appUserId":"openclaw-smoke-test-user"}'
$putH = $H.Clone()
$putH["Content-Type"] = "application/json"
Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$testTg" -Method Put -Headers $putH -Body $body | Out-Null
$got = Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$testTg" -Headers $H
Write-Host "binding GET:" ($got | ConvertTo-Json -Compress)
if ($got.appUserId -ne "openclaw-smoke-test-user") { throw "unexpected appUserId" }
Invoke-RestMethod -Uri "$base/v1/telegram-bindings/$testTg" -Method Delete -Headers $H | Out-Null
Write-Host "OK: telegram-bindings round-trip"
