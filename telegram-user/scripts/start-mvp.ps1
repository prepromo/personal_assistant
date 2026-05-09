# Поднимает тестовый MVP: API + подсказки по воркеру и auth.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Write-Host "=== Telegram User MVP ===" -ForegroundColor Cyan
Write-Host "1) Откроется окно: npm run dev (API + http://127.0.0.1:4050/mvp.html)" -ForegroundColor White
Write-Host "2) В другом окне: .\scripts\run-telegram.ps1  (логин + worker)" -ForegroundColor White
Write-Host "3) Опционально: .\scripts\run-auth-server.ps1  (порт 4052)" -ForegroundColor DarkGray
Write-Host ""
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$root`"; npm run dev"
Start-Sleep -Seconds 2
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:4050/health" -TimeoutSec 5 -ErrorAction Stop
    $j = $h | ConvertTo-Json -Compress
    Write-Host "health: $j" -ForegroundColor Green
}
catch {
    Write-Host "API еще поднимается - подождите несколько секунд." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Браузер: http://127.0.0.1:4050/mvp.html" -ForegroundColor Green
Write-Host "Токен и accountId: telegram-user\.env и .last-account-id" -ForegroundColor DarkGray
