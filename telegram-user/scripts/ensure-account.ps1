param([string]$AppUserId = "00000000-0000-0000-0000-000000000001")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot "load-dotenv.ps1") -Root $root

$port = if ($env:PORT) { $env:PORT } else { "4050" }
$secret = $env:CONNECTOR_SECRET
if (-not $secret) { throw "Set CONNECTOR_SECRET in .env" }

$uri = "http://127.0.0.1:$port/internal/ensure-account"
$body = @{ appUserId = $AppUserId } | ConvertTo-Json -Compress

try {
    $r = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json; charset=utf-8" `
        -Headers @{ "X-Connector-Secret" = $secret }
} catch {
    Write-Host "API not reachable. Is npm run dev running in telegram-user?" -ForegroundColor Red
    throw
}

$aid = $r.accountId
Write-Host "OK accountId = $aid" -ForegroundColor Green
$out = Join-Path $root ".last-account-id"
$aid | Set-Content -Path $out -Encoding utf8
Write-Host "Saved to $out" -ForegroundColor DarkGray
$r
