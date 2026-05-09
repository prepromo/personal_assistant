# OpenClaw и v1 (задачи / напоминания)

**Веб-кабинет** (логин/пароль, без `AGENT_API_TOKEN` в браузере): `http://127.0.0.1:4050/cabinet.html`, API `/api/v1/cabinet/*` — см. **`docs/CABINET.md`**. Скилл OpenClaw ниже по-прежнему ходит в **`/v1/...`** с **`AGENT_API_TOKEN`**.

Пользователь **вручную** задаёт действия в OpenClaw (чат с ботом / gateway). Чтобы агент создавал задачи и напоминания в **telegram-user API**, нужен вызов REST с заголовком:

## Почему не `web_fetch`

Инструмент **`web_fetch`** в OpenClaw **не обращается к localhost / частным сетям**. Для локального **`http://127.0.0.1:4050`** используется связка **skill + `exec` + PowerShell**:

1. В репозитории: **`openclaw/skills/telegram-user/`** (`SKILL.md`, `invoke.ps1`).
2. Установка в профиль: **`openclaw/scripts/install-telegram-user-skill.ps1`** → копия в **`%USERPROFILE%\.openclaw\skills\telegram-user\`**.
3. В **`openclaw/.env`**: **`TELEGRAM_USER_BASE_URL`**, **`TELEGRAM_USER_AGENT_TOKEN`** (= **`AGENT_API_TOKEN`** в `telegram-user/.env`); **`scripts/apply-env-to-openclaw.ps1`** дописывает их в **`~/.openclaw/.env`**.
4. Перезапуск gateway. Агент по инструкции из **SKILL.md** вызывает **`pwsh -File ...\invoke.ps1 -Action ...`**.

Проверка скрипта без бота: **`openclaw/scripts/test-telegram-user-invoke.ps1`** (должен быть запущен **telegram-user API**).

**Привязка из консоли** (после того как узнали свой числовой Telegram user id):

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\seed-telegram-binding.ps1 -TelegramUserId "123456789" -AppUserId "ваш-app-user-id"
```

**Политика `exec` в OpenClaw:** при **`tools.profile`: `minimal`** инструмент **`exec`** может быть недоступен. Для скилла нужен профиль с **`exec`** (например **`openclaw config set tools.profile full`**) и перезапуск gateway.

**Диалоги и сообщения:** `GET /v1/app-users/:appUserId/tg-account` → `{ accountId }`; далее `GET /v1/accounts/:accountId/dialogs`, `GET /v1/dialogs/:dialogId/messages`. В **`invoke.ps1`**: действия **`account-for-app`**, **`dialogs-list`**, **`messages-list`**, **`dialogs-send`** (очередь на отправку, доставку делает **worker**). Данные появляются после синка **connector + worker** (MTProto).

## HTTP (произвольный клиент)

Для **curl**, другого сервиса или хоста в Docker используйте обычный REST с заголовком:

```http
Authorization: Bearer <AGENT_API_TOKEN>
```

Базовый URL (локально): `http://host.docker.internal:4050` или `http://127.0.0.1:4050` (если gateway на той же машине).

В **`openclaw/.env`** можно задать те же значения под именами `TELEGRAM_USER_BASE_URL` и `TELEGRAM_USER_AGENT_TOKEN` (см. `openclaw/.env.example`) — скрипт проверки подставляет их в запросы.

## Привязка Telegram user id → `appUserId` (мультипользователь)

В личке с ботом **Telegram user id** совпадает с `message.from.id`. Его хранит таблица **`TgBotUserBinding`** (миграция Prisma). Агент сначала **резолвит** id, затем вызывает задачи/напоминания.

**Получить `appUserId` и `accountId` (если есть `TgAccount`):**

```http
GET /v1/telegram-bindings/{telegramUserId}
Authorization: Bearer <AGENT_API_TOKEN>
```

Ответ `200`: `telegramUserId`, `appUserId`, `accountId` (или `null`), `updatedAt`. `404` — привязки нет.

**Создать или обновить привязку:**

```http
PUT /v1/telegram-bindings/{telegramUserId}
Content-Type: application/json
Authorization: Bearer <AGENT_API_TOKEN>

{"appUserId":"<uuid или id пользователя продукта>"}
```

**Удалить:** `DELETE /v1/telegram-bindings/{telegramUserId}`.

Рекомендуемый порядок для tool-цепочки: `GET …/telegram-bindings/{id}` → `POST …/app-users/{appUserId}/tasks` (или reminders).

## Примеры

**Создать задачу** (`appUserId` — UUID пользователя продукта):

```http
POST /v1/app-users/{appUserId}/tasks
Content-Type: application/json

{"title":"Позвонить клиенту","body":"до 18:00"}
```

**Создать напоминание** (`accountId` — UUID `TgAccount` из БД, если нужен Telegram):

```http
POST /v1/app-users/{appUserId}/reminders
Content-Type: application/json

{
  "title": "Дедлайн",
  "text": "Отправить отчёт",
  "fireAt": "2026-04-02T15:00:00.000Z",
  "notifyTelegram": true,
  "notifyWeb": true,
  "accountId": "<uuid TgAccount>"
}
```

**Список задач:**

```http
GET /v1/app-users/{appUserId}/tasks
```

**Список напоминаний:**

```http
GET /v1/app-users/{appUserId}/reminders
```

В OpenClaw укажите тот же `AGENT_API_TOKEN`, что в `telegram-user/.env`. Подробнее по gateway: `openclaw/README.md`.
