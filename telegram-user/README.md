# Telegram User (личный аккаунт, MTProto)

Сервис для **личного** Telegram-аккаунта: синхронизация диалогов и сообщений в БД, **внутренний HTTP API** для агента (OpenClaw/tools) без прямого доступа к MTProto.

**Не путать с Comrade:** Comrade использует **Bot API** (бот, каналы). Этот модуль — **MTProto / user session**.

**Продуктовый бот:** один BotFather-бот — меню **«Автоответы»** и **«Помощь»** (политика автоответов; исполнение через MTProto worker). Токен `PRODUCT_BOT_TOKEN` в `.env`, `npm run dev` → polling. Старые runbook/PRD: [docs/BOT-MVP-RUNBOOK.md](docs/BOT-MVP-RUNBOOK.md). **Развёртывание в прод и про GitHub Pages:** [docs/DEPLOY.md](docs/DEPLOY.md).

## MVP: как запустить (Windows)

**Вариант «всё сразу»** — в PowerShell из каталога `telegram-user`:

```powershell
.\scripts\start-dev.ps1
```

Откроется новое окно с `npm run dev`; в текущем окне выполнится `ensure-account`, в корень запишется **`.last-account-id`**.

**Если API уже запущен** — только создать аккаунт в БД:

```powershell
.\scripts\ensure-account.ps1
```

Не используйте `curl` с вложенными кавычками в PowerShell для JSON — скрипт вызывает `Invoke-RestMethod`.

Дальше **вручную**:

1. В **`connector/.env`** впишите **`TELEGRAM_API_ID`** и **`TELEGRAM_API_HASH`** с [my.telegram.org](https://my.telegram.org) (файл уже создан, секреты совпадают с `telegram-user/.env`).
2. `cd connector` → venv → `pip install -r requirements.txt` → **`python login.py`** → воркер: **`.\scripts\start-worker.ps1`** (из каталога `telegram-user`) или **`python worker.py`** в `connector`. Проверка: **`.\scripts\check-worker-health.ps1`**.

Проверка списка диалогов (подставьте токен из `.env` и `accountId` из `.last-account-id`):

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4050/v1/accounts/<ACCOUNT_ID>/dialogs" -Headers @{ Authorization = "Bearer local-dev-agent-token-2026" }
```

Отправка в Telegram из API: `POST /v1/dialogs/<dialogId>/send` с телом `{"text":"..."}` — очередь `TgPendingSend`, воркер отправляет через Pyrogram.

**Официальная витрина:** после `npm run build:landing` в каталоге `telegram-user` корень **http://127.0.0.1:4050/** отдаёт лендинг из `prepromo-landing` (`public/index.html`). Без сборки лендинга `/` по-прежнему редиректит на **`/start.html`**. **Тестовый MVP** (панель в браузере): [docs/MVP-RUNBOOK.md](docs/MVP-RUNBOOK.md) — **http://127.0.0.1:4050/mvp.html**. Быстрый старт: `.\scripts\start-mvp.ps1`.

**v1:** задачи и напоминания — `GET/POST /v1/app-users/:appUserId/tasks`, `GET/POST .../reminders`, планировщик в API, Telegram через воркер (`peer me`). OpenClaw: [docs/V1-OPENCLAW.md](docs/V1-OPENCLAW.md). **Автоответы с user-аккаунта** (`replyMode` + LLM): [docs/AUTOMATION.md](docs/AUTOMATION.md). Ручные шаги: [docs/USER-TURN.md](docs/USER-TURN.md). Чеклист продукта: [docs/PRODUCT-CHECKLIST.md](docs/PRODUCT-CHECKLIST.md). **Пользователь:** [docs/USER-GUIDE.md](docs/USER-GUIDE.md), сценарии: [docs/SCENARIO-MATRIX.md](docs/SCENARIO-MATRIX.md), dev: [docs/DEV-STABILITY.md](docs/DEV-STABILITY.md). Локальный Postgres: [docs/LOCAL-POSTGRES.md](docs/LOCAL-POSTGRES.md). Docker: `docker compose up -d --build` (Postgres + API; воркер отдельно).

## 1. Обзор стека

Подробнее: [docs/adr/0001-personal-telegram-mtproto-stack.md](../docs/adr/0001-personal-telegram-mtproto-stack.md).

- **Коннектор (MVP):** Python + **Pyrogram** — `connector/login.py`, `connector/worker.py`.
- **Коннектор (целевой):** TDLib sidecar при росте требований к стабильности.
- **API:** Node.js **Express** — `src/server.ts`, маршруты `src/routes/agent.ts` и `src/routes/internal.ts`.
- **БД:** отдельный Prisma-проект (`prisma/schema.prisma`), **PostgreSQL** (`DATABASE_URL`). Локально: `docker compose up -d postgres` в этом каталоге (порт **5433** на хосте).

## 2. Схема модулей

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OpenClaw /     │     │  API Gateway      │     │  Policy +       │
│  агент (tools)  │────▶│  (JWT, rate)      │────▶│  Audit          │
└─────────────────┘     └────────┬─────────┘     └────────┬────────┘
                                 │                        │
                                 ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Application    │     │  Prisma DB      │
                        │  (use-cases)    │     │  dialogs, msgs  │
                        └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Update queue   │
                        │  (BullMQ /      │
                        │   in-proc MVP)  │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  MTProto        │
                        │  Connector      │
                        │  (Python MVP)   │
                        └─────────────────┘
```

| Модуль | Назначение |
|--------|------------|
| **Connector** | Держит user session, получает updates, отправляет сообщения; пишет в БД / в очередь. |
| **API Gateway** | REST для агента: `list_dialogs`, `get_history`, `send_message`, `mark_read`; без MTProto. |
| **Session storage** | Шифрованный blob сессии в БД (`TgAccount.sessionEnc`), ключ в KMS/env. |
| **Модель данных** | См. `prisma/schema.prisma`: аккаунт, диалоги, сообщения, курсоры синка, аудит. |
| **Очередь обновлений** | От коннектора → воркеры дедуплицируют и upsert в БД; MVP — in-process или Redis + BullMQ. |

## 3. MVP vs отложено

### MVP (первая итерация)

- Одна учётная запись продукта ↔ один `TgAccount` (позже multi-account).
- Коннектор: вход по коду/сессии (без полного UI) — см. ISSUES.
- Синхронизация: список диалогов + последние N сообщений на диалог.
- Internal API: read-only + `send_message` + `mark_read` за флагом политики.
- Аудит: запись всех вызовов API агента.

### Отложено

- TDLib sidecar, горизонтальное масштабирование коннекторов на аккаунт.
- Полный поиск по медиа, папки Telegram 1:1 с клиентом.
- Multi-tenant изоляция на уровне шардов БД.
- Пользовательские workflow/«команды» без кода (конструктор).

## 4. Угрозы и меры

| Угроза | Мера |
|--------|------|
| Утечка session | Шифрование at-rest (`sessionEnc`), ключ не в git; ротация; минимум логов с текстом. |
| 2FA / пароль | Интерактивный первый вход в коннекторе; не хранить пароль plaintext. |
| Отзыв доступа | Статус `revoked`, удаление session, остановка коннектора. |
| Злоупотребление API агента | Rate limit, policy per `userId`, обязательный audit trail. |
| Flood / бан Telegram | Backoff, лимиты отправки, мониторинг ошибок MTProto. |

## 5. Стыковка с Comrade и OpenClaw

| Компонент | Роль |
|-----------|------|
| **Comrade** | Остаётся каналом для **ботов** (B2B инбокс). Связь с `telegram-user` — опционально: общий `userId` в JWT и ссылка «у пользователя подключён личный аккаунт». |
| **OpenClaw** | Агент вызывает **HTTP** `telegram-user` API (Bearer service token или user token + scopes), не MTProto. Tools в OpenClaw = обёртки над этими эндпоинтами. |
| **Монорепо** | Каталог `telegram-user/` — отдельный пакет (свой `package.json`, Prisma). Позже можно вынести в отдельный репозиторий без смены контракта API. |

Рекомендация: **отдельный процесс/сервис** для коннектора + **отдельный** API-сервер (или объединённый Node-процесс только для API, коннектор — соседний контейнер).

## 6. Документы и артефакты

- [docs/ISSUES.md](./docs/ISSUES.md) — следующие шаги (как тикеты).
- [openapi/agent-internal.yaml](./openapi/agent-internal.yaml) — черновик API для агента.
- [prisma/schema.prisma](./prisma/schema.prisma) — модель данных.
- [src/](./src/) — сервер и маршруты; [connector/](./connector/) — Pyrogram.

## Локальная разработка

```bash
cd telegram-user
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev
```

```bash
cd connector
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env
python login.py
python worker.py
```
