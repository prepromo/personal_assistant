# Веб-кабинет (продукт)

## Переменные

| Переменная | Назначение |
|------------|------------|
| `CABINET_JWT_SECRET` | Обязательна для JWT (мин. 16 символов). |
| `CORS_ORIGINS` | Список origin через запятую или `*` для любого. Если не задано — по умолчанию `http://localhost:5173` и `http://127.0.0.1:5173` (Vite). |
| **LLM (чат с ассистентом)** | |
| `OPENCLAW_GATEWAY_URL` | Например `http://127.0.0.1:18789` |
| `OPENCLAW_GATEWAY_TOKEN` | Токен gateway (см. `openclaw/README.md`) |
| `OPENCLAW_CHAT_MODEL` | По умолчанию `custom-gigachat-devices-sberbank-ru/GigaChat` (completions); `openclaw/default` — полный агент OpenClaw |
| `OPENAI_BASE_URL` + `OPENAI_API_KEY` | Альтернатива: любой OpenAI-совместимый endpoint (gpt2giga и т.д.) |
| **OIDC** | |
| `OIDC_ISSUER` | Discovery URL провайдера (Google: `https://accounts.google.com`) |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Из консоли провайдера |
| `OIDC_REDIRECT_URI` | Должен совпадать с зарегистрированным, напр. `http://127.0.0.1:4050/api/v1/auth/oidc/callback` |
| `OIDC_SUCCESS_REDIRECT` | После входа, по умолчанию `/cabinet.html` |

## Поток

1. Connector: `ensure-account` + `login.py` → `TgAccount`.
2. Регистрация `POST /api/v1/auth/register` или **OIDC**: открыть `/api/v1/auth/oidc/start?appUserId=...`.
3. UI: `http://127.0.0.1:4050/cabinet.html` — cookie + `sessionStorage` с JWT для cross-origin.
4. **Чат с ассистентом**: `POST /api/v1/cabinet/chat/messages` — сервер вызывает LLM (OpenClaw Gateway или OpenAI-совместимый URL).

## Отдельный фронт (Vite) без ручного CORS

```text
cd telegram-user/cabinet-ui
npm install
npm run dev
```

Прокси в `vite.config.ts` пересылает `/api` и `/health` на `http://127.0.0.1:4050` — браузер общается только с `:5173`, CORS к API не нужен. После логина токен храните в `sessionStorage` и шлите `Authorization: Bearer`.

## Совместимость с OpenClaw

Скилл `invoke.ps1` использует **`AGENT_API_TOKEN`** и `/v1/...`. Кабинет — отдельные маршруты `/api/v1/...`.

## Проверка

```powershell
cd telegram-user
.\scripts\test-cabinet.ps1
```

Освободить порт 4050 (Windows):

```powershell
.\scripts\stop-port.ps1 -Port 4050
```

## Автоответ (заглушка)

`policyJson.replyMode`: см. основной README. Реальный LLM в чате — через переменные LLM выше.
