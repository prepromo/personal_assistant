# Стабильность и разработка (локально)

## Переменные окружения

- **БД:** `DATABASE_URL` — **PostgreSQL** (локально через `docker compose` в `telegram-user`).
- **LLM:** `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN` **или** `OPENAI_BASE_URL` + `OPENAI_API_KEY` (и модель). Без этого автоответы и извлечение заметок/напоминаний не работают.
- **Продуктовый бот:** `PRODUCT_BOT_TOKEN`.
- **Автоматизация:** см. `.env.example` — `AUTOMATION_*`, `REMINDER_SNOOZE_MINUTES`.

## Health

`GET /health` — `ok`, worker lastSeen, productBot, поле `llm.configured` (проверка наличия ключей для chat completion).

## Бэкап БД

- **PostgreSQL:** `pg_dump` по расписанию (прод и локально при необходимости).

## Лимиты LLM

Повтор при 429: `LLM_MAX_ATTEMPTS`, `LLM_RETRY_BASE_MS`.  
Токены автоответов: `AUTOMATION_MAX_TOKENS`.  
Второй проход (заметки/напоминания): `AUTOMATION_ACTIONS_MAX_TOKENS`.

## Проверка типов

```bash
cd telegram-user && npx tsc --noEmit
```

## Ручной смоук (после изменений бота)

1. `/start` → онбординг или меню.  
2. Каждая кнопка главного меню открывается без ошибки.  
3. «Режим чатов» при подключённом аккаунте — список диалогов, смена режима.  
4. Напоминание с `requiresBotAck` (из теста БД или автоответа) — сообщение с «Сделано» / «Ещё нет».
