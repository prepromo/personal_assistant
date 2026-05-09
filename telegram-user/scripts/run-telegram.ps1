# Activates connector venv, runs login.py (interactive) then worker.py
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$conn = Join-Path $root "connector"
$venvPy = Join-Path $conn ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "Creating venv and installing deps..." -ForegroundColor Cyan
    Set-Location $conn
    python -m venv .venv
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    Set-Location $root
}

$envFile = Join-Path $conn ".env"
if (-not (Test-Path $envFile)) { throw "Missing connector/.env" }
$tid = ""
$thash = ""
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*TELEGRAM_API_ID=(.*)$') { $tid = $matches[1].Trim() }
    if ($_ -match '^\s*TELEGRAM_API_HASH=(.*)$') { $thash = $matches[1].Trim() }
}
if (-not $tid -or $tid -eq "" -or -not ($tid -as [long]) -or $tid -lt 1) {
    Write-Host "Set TELEGRAM_API_ID and TELEGRAM_API_HASH first:" -ForegroundColor Yellow
    Write-Host "  .\scripts\set-telegram-api.ps1 -ApiId YOUR_ID -ApiHash YOUR_HASH" -ForegroundColor White
    Write-Host "  https://my.telegram.org/apps" -ForegroundColor White
    exit 1
}
if (-not $thash -or $thash.Length -lt 8) {
    Write-Host "TELEGRAM_API_HASH missing. Use set-telegram-api.ps1" -ForegroundColor Yellow
    exit 1
}

Set-Location $conn
Write-Host "Step 1/2: login.py (phone + code)..." -ForegroundColor Cyan
& .\.venv\Scripts\python.exe login.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Step 2/2: worker.py (Ctrl+C to stop)..." -ForegroundColor Cyan
& .\.venv\Scripts\python.exe worker.py
