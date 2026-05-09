$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
. (Join-Path $PSScriptRoot "load-dotenv.ps1") -Root $root

Write-Host "npm install..." -ForegroundColor Cyan
npm install
Write-Host "prisma migrate deploy..." -ForegroundColor Cyan
npx prisma migrate deploy
npx prisma generate

Write-Host "Starting API in new window (leave it open)..." -ForegroundColor Cyan
Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-Command", "Set-Location '$root'; npm run dev"
)

Start-Sleep -Seconds 4
Write-Host "ensure-account..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "ensure-account.ps1")

Write-Host ""
Write-Host "Next steps (you):" -ForegroundColor Yellow
Write-Host "  1) Edit connector/.env: TELEGRAM_API_ID, TELEGRAM_API_HASH (my.telegram.org)" -ForegroundColor White
Write-Host "  2) cd connector" -ForegroundColor White
Write-Host "     python -m venv .venv" -ForegroundColor White
Write-Host "     .\.venv\Scripts\activate" -ForegroundColor White
Write-Host "     pip install -r requirements.txt" -ForegroundColor White
Write-Host "     python login.py" -ForegroundColor White
Write-Host "     python worker.py" -ForegroundColor White
