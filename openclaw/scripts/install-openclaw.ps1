# Установка OpenClaw глобально и первичный onboard без каналов (для отладки).
# Запуск от администратора не обязателен.
# После скрипта: openclaw gateway run

$ErrorActionPreference = "Stop"
Write-Host "npm install -g openclaw@latest ..." -ForegroundColor Cyan
npm install -g openclaw@latest
Write-Host "onboard (skip auth, skip health) ..." -ForegroundColor Cyan
openclaw onboard --non-interactive --accept-risk --auth-choice skip --no-install-daemon --skip-channels --skip-skills --skip-search --skip-health
Write-Host "`nГотово. Проверка:" -ForegroundColor Green
openclaw --version
Write-Host "`nЗапуск шлюза:  openclaw gateway run" -ForegroundColor Yellow
Write-Host "Статус:         openclaw gateway status" -ForegroundColor Yellow
Write-Host "Health:         openclaw health --json" -ForegroundColor Yellow
