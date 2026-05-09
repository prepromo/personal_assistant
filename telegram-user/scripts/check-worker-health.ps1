# GET /health -> worker.lastSeenAt (worker.py pings ~every 120s).
# Run from telegram-user: .\scripts\check-worker-health.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
    Write-Error "Missing .env in $root"
}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"')
        if ($k) { Set-Item -Path "env:$k" -Value $v }
    }
}

$port = if ($env:PORT) { $env:PORT } else { "4050" }
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Method Get -TimeoutSec 5
} catch {
    Write-Host "API not reachable on port $port. Run: npm run dev" -ForegroundColor Red
    throw
}

Write-Host "ok:      $($h.ok)" -ForegroundColor Cyan
Write-Host "service: $($h.service)"
$seen = $h.worker.lastSeenAt
if ($seen) {
    Write-Host "worker lastSeenAt: $seen" -ForegroundColor Green
    Write-Host "Worker recently pinged the API."
} else {
    Write-Host "worker lastSeenAt: null" -ForegroundColor Yellow
    Write-Host "Run: .\scripts\start-worker.ps1 or .\scripts\start-worker.ps1 -NewWindow"
}
