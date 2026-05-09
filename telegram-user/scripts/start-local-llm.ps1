# Поднимает gpt2giga (OpenAI-совместимый прокси на :8090) из каталога openclaw соседом с telegram-user.
# Нужно, если в telegram-user/.env заданы OPENAI_BASE_URL=http://127.0.0.1:8090/v1 и OPENAI_API_KEY (см. openclaw/README.md).
$ErrorActionPreference = "Stop"
$telegramUserRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $telegramUserRoot -Parent
$openclawDir = Join-Path $repoRoot "openclaw"
$starter = Join-Path $openclawDir "scripts\start-gpt2giga.ps1"
if (-not (Test-Path $starter)) {
    throw "Не найден openclaw: ожидался $starter (монорепо: repo/openclaw рядом с repo/telegram-user)."
}
& $starter
