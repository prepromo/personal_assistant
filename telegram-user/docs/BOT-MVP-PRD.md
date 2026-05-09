# Продуктовый Telegram-бот (MVP)

## Зачем внутри `telegram-user`

Один процесс Node уже поднимает HTTP API, Prisma и планировщики. Бот на **grammy** живёт в том же сервисе: не нужен отдельный деплой для MVP. MTProto (Pyrogram worker) **не обязателен**: пользователь работает через **Bot API**.

## Модель данных

| Сущность | Назначение |
|----------|------------|
| `TgBotUserBinding` | `telegramUserId` → `appUserId`. До входа MTProto — гостевой `bot-<tg_id>`; после **`login.py`** — тот же `appUserId`, что у `TgAccount` (`POST /internal/link-telegram-user-to-account`). `metaJson` — шаг диалога. |
| `BotConnectedChat` | Чаты/каналы, добавленные пересылкой сообщения боту. |
| `Task` | Задачи с тем же `appUserId`, что и у привязки. |
| `Reminder` | Напоминания с `accountId = null`: доставка в Telegram через **PRODUCT_BOT_TOKEN** (см. планировщик). |

Расширение MTProto: позже можно создать `TgAccount` с тем же `appUserId` и связать личный аккаунт — код агента уже использует `appUserId`.

## Кнопки главного меню

| Кнопка | Действие |
|--------|----------|
| Мои чаты | Список `BotConnectedChat`; inline: **из синка** (`TgDialog` по `TgAccount`), **ввести id** (число, опц. название), пересылка сообщения. |
| Команды агента | Статический текст шаблонов + TODO OpenClaw. |
| Новая задача | Диалог: одно сообщение → `Task` + вызов `agentStub`. |
| Напоминания | Список pending; подменю «➕ Напоминание» (время → заголовок → текст). |
| Запрос дайджест | Создаёт `Task` «Дайджест…» + `enqueueAgentJob("digest", …)`. |
| Статус | Health: worker ping, `AGENT_API_TOKEN`, `OPENCLAW_GATEWAY_URL`. |
| Помощь | Краткая справка. |

## Потоки

1. **Регистрация:** `/start` → `upsert` в `TgBotUserBinding`, показ клавиатуры.
2. **Чат:** пользователь в личке пересылает сообщение → извлекается `forward_origin` → upsert `BotConnectedChat`.
3. **Задача:** кнопка → шаг `task_title` → текст → `Task.create`.
4. **Напоминание:** ➕ → время (ISO или `+минуты`) → заголовок → текст → `Reminder` без `accountId`.

## Интеграция агента

- `src/lib/agentStub.ts` — лог в консоль; при появлении очереди/OpenClaw подключать сюда.
- `AGENT_API_TOKEN` / `/v1/app-users/:appUserId/tasks` можно вызывать из того же процесса при необходимости (сейчас бот пишет в БД напрямую).

## Ошибки Telegram API

| Симптом | Причина |
|---------|---------|
| 401 при sendMessage | Неверный `PRODUCT_BOT_TOKEN`. |
| 403 | Пользователь не нажал /start или заблокировал бота. |
| 429 | Flood limit — реже слать или backoff. |
| Webhook: 403 от сервера | Не совпал `PRODUCT_BOT_WEBHOOK_SECRET` с `secret_token` в `setWebhook`. |

Логи: `console.error` в `telegramBotSend`, `productBot` catch, `reminderScheduler`.
