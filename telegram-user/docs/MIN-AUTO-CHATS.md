# Минимум «авто в чатах с людьми» — что должно быть включено

Автоматическая цепочка: **входящее в Telegram** → **ingest** → **`TgAutomationJob`** → **LLM** (`OPENCLAW_*`) → **`TgPendingSend`** → **worker** → отправка **от вашего user-аккаунта**.

## Чеклист процессов

| Компонент | Порт / команда |
|-----------|----------------|
| **telegram-user API** | `4050` — `npm run dev` |
| **gpt2giga** (если gateway с ним) | `8090` — `openclaw/scripts/start-gpt2giga.ps1` |
| **OpenClaw gateway** (LLM для automation) | `18789` — `openclaw/scripts/start-gateway.ps1` |
| **worker** | `connector` — `telegram-user/scripts/start-worker.ps1` |

Проверки:

- `GET http://127.0.0.1:4050/health` — `worker.lastSeenAt` недавний.
- `.\scripts\check-worker-health.ps1`
- Gateway: `GET http://127.0.0.1:18789/v1/models` с `Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>`.

## Политика

В кабинете или `PATCH /v1/accounts/:accountId/policy`:

```json
{ "replyMode": "auto", "sendAllowed": true }
```

Сессия личного аккаунта в БД: `GET /internal/session/:appUserId` (заголовок `X-Connector-Secret`) → **200**.

## Тест

С **другого аккаунта** или устройства напишите себе в **личку**. Подождите несколько секунд (poll автоматизации + LLM + очередь). Ответ должен уйти **от вашего имени** (не от бота).

При **429** от GigaChat — подождите или снизьте частоту; в `.env` см. `LLM_MAX_ATTEMPTS`, `LLM_RETRY_BASE_MS`.

## Ошибка `400 CHAT_ADMIN_REQUIRED`

Часто в **группах/каналах**, где обычным участникам **запрещено** писать (только админы). User-аккаунт не может отправить ответ.

**По умолчанию** авто/suggest создаются **только для личных диалогов** (`dialogType: user`). В кабинете можно включить **«Автоответы в группах/каналах»** (`autoInGroups: true`) — только если у вас есть права на отправку.

Проверка: напишите с **другого аккаунта** в **личку** (не в группу).
