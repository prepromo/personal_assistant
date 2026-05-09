# MVP: тестовый прогон с реальными данными

Цель: **локально** поднять API, **личный** Telegram (MTProto), проверить **диалоги / сообщения / отправку** и при необходимости **вход по телефону через браузер**.

## Компоненты

| Что | Порт | Назначение |
|-----|------|------------|
| `npm run dev` | 4050 | Express: `/health`, `/internal/*`, `/v1/*`, статика **`/mvp.html`** |
| `worker.py` | — | Pyrogram: синк, входящие, очередь отправки |
| `auth_server.py` (опционально) | 4052 | HTTP: отправить SMS/код, завершить вход, сохранить сессию в БД |

## Быстрый старт

```powershell
cd telegram-user
.\scripts\start-mvp.ps1
```

Во **втором** окне (после того как API поднялся):

```powershell
cd telegram-user
.\scripts\run-telegram.ps1
```

Либо только `login.py`, затем `worker.py` вручную — см. `START.md`.

## Веб-панель (без Postman)

Стартовая страница (выбор MVP или кабинета):

**http://127.0.0.1:4050/** → редирект на `/start.html`

Сразу тестовый MVP:

**http://127.0.0.1:4050/mvp.html**

- Адрес API подставляется сам, если открываете с того же хоста, что и сервер.
- Вставьте **`AGENT_API_TOKEN`** из `telegram-user/.env`.
- **`accountId`** — из файла **`.last-account-id`** (или ответ `ensure-account`).
- Загрузите диалоги, при необходимости сообщения и тестовую отправку.

Токены в панели хранятся в **localStorage** — только для локальной отладки.

## Вход по телефону из браузера (опционально)

1. Убедитесь, что API на **4050** запущен.
2. Установите зависимости коннектора (один раз): в `connector/` — `pip install -r requirements.txt`.
3. Запуск:

```powershell
cd telegram-user
.\scripts\run-auth-server.ps1
```

4. В **`mvp.html`** раздел «Вход по телефону»: укажите **`appUserId`** из `connector/.env`, телефон **`+7…`**, **`X-Connector-Secret`** (тот же, что в `telegram-user/.env` и `connector/.env`).

После успешного входа сессия попадает в БД — запустите **`run-telegram.ps1`** (только **worker**, если сессия уже есть — можно `python worker.py` после ручного логина; при полном `run-telegram.ps1` снова пройдёт `login` — для чистого воркера используйте отдельный запуск `worker.py`).

**Проще:** после веб-входа выполните только **`python worker.py`** в `connector/` (venv), без повторного интерактивного `login.py`.

## PostgreSQL и Docker (локальный «стек»)

Схема Prisma рассчитана на **PostgreSQL**. В **`.env`** задайте `DATABASE_URL`, например для Postgres из compose на хосте:

`postgresql://tguser:tguser@127.0.0.1:5433/tguser`

Готовый **Postgres + API** в одном compose:

```powershell
cd telegram-user
docker compose up -d --build
```

API: **http://127.0.0.1:4050**. Коннектор **`worker.py`** в контейнер не входит — запускайте на хосте рядом с тем же `CONNECTOR_SECRET` и `API_BASE_URL=http://127.0.0.1:4050`.

Миграции: `npx prisma migrate deploy` (после старта Postgres).

## v1: задачи и напоминания

- **Задачи:** `GET/POST /v1/app-users/:appUserId/tasks`, `PATCH/DELETE .../tasks/:taskId`.
- **Напоминания:** `GET/POST .../reminders`, `PATCH .../reminders/:id` (отмена), `GET .../reminders/web-inbox`.
- Планировщик в процессе Node срабатывает каждые ~15 с; Telegram — очередь `TgPendingSend` с `peerKey=me` (нужен **worker**).

OpenClaw: [V1-OPENCLAW.md](V1-OPENCLAW.md).

## OpenClaw (отдельный бот / GigaChat)

Не входит в этот сервис. См. **`openclaw/README.md`** — запуск `.\scripts\start-gateway.ps1` и токен бота в `openclaw/.env`. Не путать с **личным** аккаунтом `telegram-user`.

## Чеклист «MVP готов к реальным данным»

- [ ] `GET /health` → `ok`
- [ ] `run-telegram.ps1` или веб-вход + `worker.py` без ошибок
- [ ] `mvp.html` показывает диалоги
- [ ] Тестовая отправка (`POST .../send`) → сообщение в Telegram
- [ ] Секреты не в git (`.env` в `.gitignore`)
