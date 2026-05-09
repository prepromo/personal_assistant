---
name: telegram_user_product
description: Задачи, напоминания, диалоги и сообщения из БД telegram-user (REST) для пользователя из Telegram.
metadata:
  openclaw:
    requires:
      config:
        - TELEGRAM_USER_AGENT_TOKEN
---

# Telegram-user (product) API

Инструмент **`web_fetch` не может ходить на `127.0.0.1`**. Для вызовов API используй **`exec`** с **`pwsh`** (или **`powershell.exe`**, если нет PS 7) и скриптом **`invoke.ps1`** (после установки — путь ниже).

## Переменные

- `TELEGRAM_USER_BASE_URL` — по умолчанию `http://127.0.0.1:4050` (сервис `telegram-user` должен быть запущен).
- `TELEGRAM_USER_AGENT_TOKEN` — тот же секрет, что **`AGENT_API_TOKEN`** в `telegram-user/.env`.

## Скрипт (после `.\scripts\install-telegram-user-skill.ps1`)

```text
%USERPROFILE%\.openclaw\skills\telegram-user\invoke.ps1
```

Примеры (одна строка для `exec`):

1. **Резолв** Telegram user id → `appUserId` (нужна строка в таблице `TgBotUserBinding`):

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.openclaw\skills\telegram-user\invoke.ps1" -Action resolve -TelegramUserId "123456789"
# или: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\invoke.ps1" ...
```

2. **Создать задачу** (когда известен `appUserId`):

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.openclaw\skills\telegram-user\invoke.ps1" -Action tasks-create -AppUserId "<appUserId>" -Title "Заголовок" -Body "Опционально"
```

3. **Список задач**:

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.openclaw\skills\telegram-user\invoke.ps1" -Action tasks-list -AppUserId "<appUserId>"
```

4. **Напоминание** (`fireAt` — ISO):

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.openclaw\skills\telegram-user\invoke.ps1" -Action reminders-create -AppUserId "<appUserId>" -Title "Напоминание" -ReminderText "Текст" -FireAt "2026-04-02T12:00:00.000Z"
```

### Диалоги и переписка (после connector + worker)

Данные в БД появляются только если **`telegram-user` API**, **`login.py`** (личный аккаунт, не бот) и **`worker.py`** запущены. Тестовые **`api_id`/`api_hash`** в `connector/.env` (например пара Telegram Desktop) подходят для отладки.

1. **`account-for-app`** — получить `accountId` по `appUserId`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.openclaw\skills\telegram-user\invoke.ps1" -Action account-for-app -AppUserId "user-388963917"
```

Или **`resolve -TelegramUserId`** — в ответе тоже есть **`accountId`** (если есть `TgAccount`).

2. **`dialogs-list`** — список диалогов:

```powershell
... -Action dialogs-list -AccountId "<uuid из account-for-app>" -Limit 30
```

3. **`messages-list`** — сообщения в диалоге:

```powershell
... -Action messages-list -DialogId "<uuid из items[].id dialogs-list>" -Limit 40
```

4. **`dialogs-send`** — поставить исходящее в очередь (`POST /v1/dialogs/:dialogId/send`, доставит **worker**):

```powershell
... -Action dialogs-send -DialogId "<uuid диалога>" -Text "Текст сообщения"
```

5. **`policy-patch`** — режим автоответов с **личного аккаунта** (после `connector` + `worker` + LLM в `telegram-user/.env`):

- `manual` — только ручная отправка через `dialogs-send`.
- `suggest` — на входящие сообщения создаётся задание; текст ответа пишется в **аудит** (`automation_suggestion_text`), в Telegram **не отправляется**.
- `auto` — на входящие генерируется ответ через **OpenClaw gateway** (или OpenAI-совместимый URL из env) и ставится в очередь **`TgPendingSend`** (отправит **worker**).

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.openclaw\skills\telegram-user\invoke.ps1" -Action policy-patch -AccountId "<uuid TgAccount>" -ReplyMode auto
```

Вернуть в безопасный режим: `-ReplyMode manual`.

## Откуда взять Telegram user id

- В логах gateway: `openclaw logs --follow` — в событиях Telegram ищи `from.id` (числовой id отправителя в личке с ботом).
- Если привязки ещё нет (`resolve` → 404), попроси пользователя один раз добавить запись через **PUT** `/v1/telegram-bindings/:id` с `appUserId` (админ или отдельный скрипт), либо вручную в БД.

## Порядок для пользователя в Telegram

1. Определи **числовой** id пользователя (логи или бот).
2. `resolve` → `appUserId`.
3. `tasks-create` / `reminders-create` с этим `appUserId`.

Ответ пользователю кратко подтверди, что запись создана (id задачи/напоминания из JSON).
