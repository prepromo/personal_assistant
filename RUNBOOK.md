# RUNBOOK — от нуля до рабочего теста

Среда: **Windows**, **PowerShell**, **Node.js 18+**, **Python** (gpt2giga / коннектор). Пути приведены от корня репозитория `VPN_service`.

---

## Цель «день 1»

**Локально проверить ИИ-чат в браузере (GigaChat) и при необходимости — ответы бота в Telegram через OpenClaw.**

Три шага:

1. Заполнить `openclaw/.env` (и при сценарии с ботом — токен от @BotFather).  
2. Выполнить команды запуска из разделов A и/или B ниже.  
3. Открыть веб (`http://127.0.0.1:3090/`) и/или написать боту в Telegram.

---

## Два независимых сценария (не смешивать)

| Сценарий | Что даёт | Зависит от |
|----------|----------|------------|
| **A — Чат в браузере** | `local-saas` + **gpt2giga** → GigaChat | `GIGACHAT_*` в `openclaw/.env`, порт **8090** |
| **B — Бот в Telegram** | **OpenClaw gateway** + Bot API | `TELEGRAM_BOT_TOKEN`, запущенный gateway, pairing при необходимости |

**telegram-user** (личный аккаунт MTProto, `worker.py`, порт **4050**) — **отдельная опция**, не входит в обязательный «минимум дня 1». Если сеть до Telegram нестабильна, сначала закройте сценарии A и B без `telegram-user`.

---

## Два пути LLM в веб-кабинете (`local-saas`)

Настройки в **`local-saas/.env`** (скопируйте из `local-saas/.env.example`).

### Путь 1 — только GigaChat (gpt2giga)

- **Зачем:** прямой чат с моделью Сбера, без агента OpenClaw.  
- **Нужно:** запущенный **gpt2giga** на `http://127.0.0.1:8090/v1` (скрипт `start-local-saas.ps1` поднимает его сам).  
- **Переменные:**  
  - `LLM_OPENAI_BASE_URL=http://127.0.0.1:8090/v1`  
  - `LLM_API_KEY` — любой непустой, если в gpt2giga отключена проверка ключа (как в типовом `openclaw/.env`).  
- **В кабинете:** провайдер **GigaChat (gpt2giga)**, модель из списка.

### Путь 2 — OpenClaw gateway (агент как у продакшена)

- **Зачем:** тот же **агент** (инструменты, сценарии), что и для Telegram-бота; веб шлёт запросы на gateway.  
- **Нужно:** запущенный **OpenClaw gateway** (например `http://127.0.0.1:18789`).  
- **Переменные в `local-saas/.env`:**  
  - `OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`  
  - `OPENCLAW_GATEWAY_TOKEN` — токен из `%USERPROFILE%\.openclaw\openclaw.json` → `gateway.auth.token`  
  - `OPENCLAW_CHAT_MODEL=openclaw/default` (или как в вашем конфиге)  
- **Токены в `openclaw/.env`** остаются для самого gateway и gpt2giga; для портала дублируете только строки gateway в **`local-saas/.env`**, чтобы браузер не ходил в gateway напрямую с секретами (прокси на сервере `local-saas`).

---

## A. От нуля до «чат в браузере»

### Предусловия

- Node.js, npm.  
- Клон `VPN_service`, заполненный **`openclaw/.env`** с `GIGACHAT_CLIENT_ID` и `GIGACHAT_CLIENT_SECRET` (и при необходимости `OPENAI_*` для OpenClaw — см. `openclaw/README.md`).  
- Установлен **gpt2giga** (`openclaw/scripts/install-gpt2giga.ps1`), если ещё не ставили.

### Команды

```powershell
cd D:\Python\Github\VPN_service
.\scripts\start-local-saas.ps1
```

Скрипт:

1. Запускает **gpt2giga** на **8090**.  
2. Копирует `local-saas/.env.example` → `local-saas/.env`, если `.env` нет.  
3. Запускает `local-saas` на **3090**.

### Проверка

1. Откройте **http://127.0.0.1:3090/status.html** — зелёные блоки или подсказки.  
2. Откройте **http://127.0.0.1:3090/dashboard.html** — выберите провайдер **GigaChat (gpt2giga)**, отправьте сообщение.  
3. Опционально: **JSON** `GET http://127.0.0.1:3090/api/status` — сводка опросов.

### Ошибки

- **gpt2giga не слушает 8090** — смотрите вывод `start-gpt2giga.ps1`, TLS/Сбер, `GIGACHAT_VERIFY_SSL_CERTS`.  
- **401/502 в чате** — проверьте `LLM_OPENAI_BASE_URL` и что gpt2giga запущен.

---

## B. От нуля до «бот в Telegram»

### Предусловия

- Выполнен **сценарий A** или вы умеете отдельно поднять **gpt2giga** (для модели агента).  
- В **`openclaw/.env`** задан **`TELEGRAM_BOT_TOKEN`** (от @BotFather).  
- Установлен OpenClaw CLI / `node` для `openclaw.mjs` (как в `openclaw/README.md`).

### Команды

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\start-gateway.ps1
```

Проверка: в логе gateway есть строка о **listening** на WebSocket (часто порт **18789**). В Telegram откройте своего бота, при **pairing** выполните в терминале (как в документации OpenClaw):

```text
openclaw pairing list telegram
openclaw pairing approve telegram <код>
```

### Связь с вебом

- В **`local-saas/.env`** задайте **`OPENCLAW_GATEWAY_URL`** и **`OPENCLAW_GATEWAY_TOKEN`** (см. «Путь 2» выше).  
- В кабинете выберите провайдер **OpenClaw gateway** — запросы пойдут в того же агента, что и бот.

### Ошибки

- **Бот молчит** — gateway не запущен, неверный токен, не пройден pairing.  
- **403** — проверить токен бота через `getMe` Bot API.

---

## Опционально: telegram-user (личный аккаунт, не бот)

**Не обязательно** для сценариев A и B.

1. `telegram-user/.env` (и `connector/.env`) по `telegram-user/README.md`.  
2. `npm install` / `prisma migrate` в `telegram-user`.  
3. `npm run dev` — API на **4050**.  
4. В `connector`: `python login.py`, затем **`python worker.py`** — нужна стабильная сеть до Telegram.

Если **worker** падает по таймаутам — это **сеть/VPN**, не «недоделанный код» чата. См. **http://127.0.0.1:4050/** (стартовая страница) и **MVP** по `telegram-user/README.md`.

**Автоответы с личного аккаунта** (не бот): после работающего API + worker задайте **`OPENCLAW_GATEWAY_*`** в **`telegram-user/.env`**, включите **`replyMode: auto`** (кабинет или **`PATCH /v1/accounts/:id/policy`** / скилл **`policy-patch`**). Подробно: **`telegram-user/docs/AUTOMATION.md`**, чеклист: **`telegram-user/docs/PRODUCT-CHECKLIST.md`**, smoke: **`telegram-user/scripts/smoke-stack.ps1`**.

---

## Вход в local-saas (прогон с паролем)

По умолчанию вход отключён (`LOCAL_SAAS_SKIP_AUTH` не `0`).

Чтобы тестировать регистрацию/логин:

1. В **`local-saas/.env`** задайте `LOCAL_SAAS_SKIP_AUTH=0`.  
2. Перезапустите `local-saas`.  
3. Зарегистрируйтесь на `/register.html` **или** создайте тестового пользователя:

```powershell
cd D:\Python\Github\VPN_service\local-saas
npm run seed:test-user
```

Логин по умолчанию после скрипта: **`test@local.dev`** / **`test123456`** (файл `local-saas/data/users.json`, не коммитится).

---

## Файлы

| Путь | Назначение |
|------|------------|
| `openclaw/.env` | GigaChat, бот, gpt2giga |
| `local-saas/.env` | Портал, LLM URL, опционально gateway |
| `local-saas/data/users.json` | Пользователи (при входе включён) |
| `telegram-user/.env` | API личного Telegram (опционально) |

---

## Что дальше (не в этом RUNBOOK)

- Домен, HTTPS, оплата, публичный туннель — отдельный этап.  
- Discord и другие каналы — через конфиг OpenClaw, не через `local-saas` напрямую.
