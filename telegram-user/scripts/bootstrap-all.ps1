# Full local bootstrap: deps, migrate, ensure-account, Python venv (no Telegram keys).
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
. (Join-Path $PSScriptRoot "load-dotenv.ps1") -Root $root

Write-Host "npm install..." -ForegroundColor Cyan
npm install
Write-Host "prisma migrate deploy + generate..." -ForegroundColor Cyan
npx prisma migrate deploy
npx prisma generate

$port = if ($env:PORT) { $env:PORT } else { "4050" }
$alive = $false
try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
    $alive = ($r.StatusCode -eq 200)
} catch { $alive = $false }

if (-not $alive) {
    Write-Host "Starting API in background window..." -ForegroundColor Cyan
    Start-Process -FilePath "powershell" -ArgumentList @(
        "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-Command", "Set-Location '$root'; npm run dev"
    )
    Start-Sleep -Seconds 5
}

Write-Host "ensure-account..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "ensure-account.ps1")

$conn = Join-Path $root "connector"
$venvPy = Join-Path $conn ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "Python venv + pip..." -ForegroundColor Cyan
    Set-Location $conn
    python -m venv .venv
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    Set-Location $root
} else {
    Write-Host "venv exists, pip install -r requirements.txt..." -ForegroundColor Cyan
    Set-Location $conn
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    Set-Location $root
}

Write-Host ""
Write-Host "DONE: API should be http://127.0.0.1:$port , account in .last-account-id" -ForegroundColor Green
Write-Host "NEXT: get api_id + api_hash from https://my.telegram.org/apps then run:" -ForegroundColor Yellow
Write-Host "  .\scripts\set-telegram-api.ps1 -ApiId ID -ApiHash HASH" -ForegroundColor White
Write-Host "  .\scripts\run-telegram.ps1" -ForegroundColor White
