# Comrade (MVP)

Единый инбокс для B2B: **Telegram** — long-polling, сохранение в БД, ответ через **OpenClaw** (GigaChat и т.д. настраиваются в OpenClaw). **WhatsApp / Email / MAX** — заглушки (`501`).

**Оплата:** по умолчанию **`BILLING_STUB=true`** — ЮKassa не вызывается, лимит trial на AI не блокирует. Для прод: `BILLING_STUB=false` и ключи ЮKassa.

Дизайн UI: **glassmorphism** (референс: [typeui.sh — Glassmorphism](https://www.typeui.sh/design-skills), локально см. `design/glassmorphism.md`).

## Структура

- `backend/` — Express, Prisma, JWT, каналы, inbox, ingest Telegram, OpenClaw probe, оплата (заглушка или ЮKassa).
- `frontend/` — Vite, React 19, Tailwind v4, React Query.

## Быстрый старт (локально)

По умолчанию БД — **SQLite** (`file:./dev.db` в `backend/.env`), Docker не обязателен.

1. `cp .env.example backend/.env` (при необходимости поправьте секреты).
2. Backend:

   ```bash
   cd backend
   npm install
   npx prisma migrate deploy
   npm run dev
   ```

3. Frontend (другой терминал):

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Прокси Vite пересылает `/api` на `http://127.0.0.1:4000`.

4. Откройте http://localhost:5173 — **регистрация**, **Каналы** → токен бота. Настройте **OpenClaw** (ниже), иначе бот ответит напоминанием про `OPENCLAW_GATEWAY_TOKEN`.

### Аккаунт (MVP)

- Подтверждение почты **отключено** (почтовый сервис не подключён). Сброс пароля по email тоже нет — при необходимости сбросьте пользователя через БД или `npm run db:reset`.
- Полная очистка БД: остановите сервер, затем `cd backend && npm run db:reset`.

## Telegram (MVP)

- Используется **getUpdates** (long-polling). После добавления канала запускается опрос.
- **Не включайте одновременно** опрос этого же бота в OpenClaw и в Comrade — будет конфликт `getUpdates` (см. `openclaw/README.md`). Один токен = один процесс, который читает апдейты.

## OpenClaw (ответы в Telegram)

**GigaChat** подключается **только в OpenClaw** (`openclaw/.env`: `GIGACHAT_*`, gpt2giga, см. `openclaw/README.md`). Comrade **не** дублирует ключи Сбера — он шлёт текст в **OpenClaw Gateway** (`POST /v1/chat/completions`), а там уже ваш прокси и модель.

1. Запустите **OpenClaw Gateway** и gpt2giga, как в `openclaw/README.md`.
2. В конфиге OpenClaw включите HTTP **chat completions**:  
   `gateway.http.endpoints.chatCompletions.enabled` → `true`  
   (см. [OpenAI Chat Completions](https://docs.openclaw.ai/gateway/openai-http-api)).
3. **Токен gateway** и URL:
   - если **ничего не задавать** в `.env` Comrade, бэкенд при старте сам подставит **`OPENCLAW_GATEWAY_TOKEN`** и при необходимости URL из **`%USERPROFILE%\.openclaw\.env`** и **`%USERPROFILE%\.openclaw\openclaw.json`** (как в Control UI OpenClaw);
   - либо явно в **`comrade/backend/.env`**: `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`;
   - либо в **`openclaw/.env`** в репозитории — загружается первым, затем перекрывается `backend/.env`.
4. По умолчанию **`OPENCLAW_CHAT_MODEL=openclaw/default`** — так OpenClaw маршрутизирует на вашего агента (у вас в `openclaw.json` уже указан GigaChat как модель агента). Сырое имя `GigaChat` в поле `model` HTTP API OpenClaw **не** принимает.
5. Перезапустите Comrade backend. Поле **`user`** в запросе к gateway — стабильный ключ чата (`comrade-tg-<channelId>-<chatId>`).

### Проверка из UI

Кнопка «Проверить шлюз» на главной вызывает `POST /api/agents` (health gateway + флаг, что задан токен).

### «fetch failed» / ECONNREFUSED в Telegram

Сообщение значит, что **бэкенд не смог открыть TCP-соединение** с `OPENCLAW_GATEWAY_URL` (часто `http://127.0.0.1:18789`). Убедитесь, что **OpenClaw Gateway запущен** на этой машине (например `openclaw\scripts\start-gateway.ps1`), gpt2giga поднят, если вы им пользуетесь. Comrade и gateway должны видеть **один и тот же** адрес; при другом порте задайте `OPENCLAW_GATEWAY_URL` в `.env`.

## ЮKassa (когда включите оплату)

- `BILLING_STUB=false`
- В личном кабинете HTTP-уведомления: `https://<домен>/api/billing/yookassa/webhook`
- Переменные: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_AMOUNT`, `FRONTEND_URL`

## Docker (только Postgres / Redis)

`docker compose up -d postgres redis` — если хотите PostgreSQL вместо SQLite: смените в `schema.prisma` провайдер на `postgresql`, задайте `DATABASE_URL` и заново создайте миграции.
