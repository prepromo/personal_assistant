# Чеклист «продукт готов локально»

## Обязательный минимум (личный аккаунт + автоответы)

1. **`telegram-user`**: `npm install`, **PostgreSQL** запущен, в **`.env`** — `DATABASE_URL` (см. `.env.example`), `npx prisma migrate deploy`, секреты, **`OPENCLAW_GATEWAY_URL`**, **`OPENCLAW_GATEWAY_TOKEN`** (или OpenAI-совместимый URL).
2. Запуск API: `npm run dev` → **http://127.0.0.1:4050/health** → `ok: true`.
3. **`connector`**: venv, `pip install -r requirements.txt`, **`login.py`**, затем **`worker.py`** (постоянно).
4. **`ensure-account`** с тем же **`appUserId`**, что в `connector/.env`.
5. Кабинет **http://127.0.0.1:4050/cabinet.html**: регистрация с этим `appUserId`, режим сначала **`suggest`**, проверка аудита **`automation_suggestion_text`**, затем **`auto`**.
6. Скрипт проверки: **`scripts/smoke-stack.ps1`** из каталога `telegram-user`.
7. Воркер: **`scripts/start-worker.ps1`** (или **`-NewWindow`**), проверка: **`scripts/check-worker-health.ps1`**.

## OpenClaw gateway

Отдельно: **gpt2giga + gateway** (`openclaw/scripts/start-gateway.ps1`) на **18789**, иначе LLM вернёт ошибку.

## Ограничения GigaChat (429)

При **`Too Many Requests`** ответы могут задерживаться; в **`chatCompletion`** включены повторы с backoff (`LLM_MAX_ATTEMPTS`, `LLM_RETRY_BASE_MS` в `.env`).

## Документация

- [AUTOMATION.md](./AUTOMATION.md) — режимы policy  
- [USER-TURN.md](./USER-TURN.md) — ручные шаги после автонастройки  
