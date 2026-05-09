# Ваши шаги после автоматической настройки

Скрипт/среда уже могла выполнить: `npm install`, миграции, запуск API на **4050**, `ensure-account`, `PATCH .../policy` → **`suggest`**, venv в `connector/`.

## 1. Окно A — OpenClaw gateway (если ещё не запущен)

Нужен для LLM в кабинете и в **automationProcessor**.

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\start-gateway.ps1
```

Проверка: `http://127.0.0.1:18789` (или `openclaw gateway status`).

## 2. Окно B — один раз: вход Pyrogram (интерактивно)

Телефон, код из Telegram, при необходимости 2FA — **только вы**.

```powershell
cd D:\Python\Github\VPN_service\telegram-user\connector
.\.venv\Scripts\Activate.ps1
python login.py
```

После успешного входа сессия сохранится через API коннектора.

## 3. Окно C — worker (постоянно, пока тестируете)

Из корня **`telegram-user`**:

```powershell
cd D:\Python\Github\VPN_service\telegram-user
.\scripts\start-worker.ps1
```

Или отдельное окно: **`.\scripts\start-worker.ps1 -NewWindow`**

Вручную (эквивалент):

```powershell
cd D:\Python\Github\VPN_service\telegram-user\connector
.\.venv\Scripts\Activate.ps1
python worker.py
```

Проверка, видит ли API воркер: **`.\scripts\check-worker-health.ps1`** (поле `worker.lastSeenAt` в `/health`).

Пока worker не шлёт пинги в API, в `/health` может быть `worker.lastSeenAt: null` — это нормально до первого пинга.

## 4. Проверка suggest

1. Напишите **с другого аккаунта** в **личку** этому же аккаунту (или в чат, который синкается).
2. Подождите 5–15 с (poll автоматизации + LLM).
3. Смотрите аудит в БД: таблица **`TgAgentAuditLog`**, действие **`automation_suggestion_text`** (Prisma Studio: `npx prisma studio` в каталоге `telegram-user`).

## 5. Включить auto (когда готовы)

```powershell
$accountId = Get-Content D:\Python\Github\VPN_service\telegram-user\.last-account-id -Raw
$accountId = $accountId.Trim()
$token = "<AGENT_API_TOKEN из telegram-user/.env>"
Invoke-RestMethod -Uri "http://127.0.0.1:4050/v1/accounts/$accountId/policy" `
  -Method Patch -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body '{"replyMode":"auto"}'
```

Откат: `"replyMode":"manual"`.

## 6. Быстрая проверка (smoke)

Из каталога `telegram-user`:

```powershell
.\scripts\smoke-stack.ps1
.\scripts\smoke-stack.ps1 -SetSuggest
```

## 7. API уже настроен

- **Health:** `http://127.0.0.1:4050/health`
- **Кабинет:** `http://127.0.0.1:4050/cabinet.html`
- **AccountId** сохранён в `telegram-user/.last-account-id`
