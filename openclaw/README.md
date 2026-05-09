# OpenClaw + GigaChat + Telegram

Здесь лежит **шаблон секретов** и скрипты запуска. Репозиторий VPN **не хранит** ваши ключи: файлы `.env` / `secrets.env` в `.gitignore`.

## 1. Секреты

```powershell
cd D:\Python\Github\VPN_service\openclaw
copy .env.example .env
# отредактируйте .env — или используйте имя secrets.env (тоже игнорируется git)
```

Заполните:

| Переменная | Откуда |
|------------|--------|
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/newbot` |
| `GIGACHAT_CLIENT_ID`, `GIGACHAT_CLIENT_SECRET` | [developers.sber.ru](https://developers.sber.ru) → GigaChat API |
| `GIGACHAT_SCOPE` | Часто `GIGACHAT_API_PERS` (для физлиц) |

## 2. Установка OpenClaw (один раз)

Нужен **Node.js 22+**.

**Вариант A — скрипт из репозитория** (глобальный `openclaw` + минимальный onboard без каналов):

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\install-openclaw.ps1
```

**Вариант B — официальный установщик:**

```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

Проверка после установки:

```powershell
openclaw --version
openclaw gateway run
# в другом окне:
openclaw gateway status
openclaw health --json
```

Ожидаемо: `RPC probe: ok`, `health` → `"ok": true`. На **Windows** OpenClaw может ругаться на WSL2 — для продакшена см. [документацию Windows](https://docs.openclaw.ai/platforms/windows).

**Модель и GigaChat:** после `onboard` с `--auth-choice skip` агент без ключей LLM — для реальных ответов выполните повторный onboard с **`--auth-choice custom-api-key`** и параметрами из README ниже, либо `openclaw configure --section model`.

## 3. Прокси gpt2giga (по умолчанию) и модель GigaChat

**Рекомендуемый путь:** локальный прокси [gpt2giga](https://github.com/ai-forever/gpt2giga) переводит запросы OpenAI-формата в GigaChat API и снимает типичные **HTTP 400** от прямого подключения OpenClaw к `gigachat.devices.sberbank.ru`. Документация Сбера: [gpt2giga proxy server](https://developers.sber.ru/docs/ru/gigachain/gpttogiga-proxy-server).

Один раз установите Python-пакет:

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\install-gpt2giga.ps1
```

В `openclaw/.env` (см. `.env.example`): `USE_GPT2GIGA_PROXY=true`, `GPT2GIGA_PORT=8090`, `OPENAI_BASE_URL=http://127.0.0.1:8090/v1`. Скрипт `start-gateway.ps1` поднимает gpt2giga на `127.0.0.1:8090`, затем обновляет `baseUrl` провайдера в `%USERPROFILE%\.openclaw\openclaw.json` и запускает gateway.

**Без прокси:** `USE_GPT2GIGA_PROXY=false` — тогда OpenClaw снова ходит напрямую на  
`https://gigachat.devices.sberbank.ru/api/v1` с коротким OAuth-токеном (как раньше).

Модель в запросах: **`GigaChat`**. Схема имён в OpenClaw — см. [документацию моделей OpenClaw](https://docs.openclaw.ai/concepts/models).

## 4. Telegram

В `~/.openclaw/.env` или в блоке `env` конфиге OpenClaw должно быть:

```text
TELEGRAM_BOT_TOKEN=ваш_токен
```

Скрипт `start-gateway.ps1` подхватывает токен из `openclaw/.env` в текущий процесс; если Gateway читает только глобальный `~/.openclaw/.env`, **скопируйте** туда строки из локального `.env` или используйте `openclaw env set TELEGRAM_BOT_TOKEN ...` (если команда есть в вашей версии).

### Один Telegram-бот только у `telegram-user` (рекомендуемая схема)

Чтобы **не делить один токен** между OpenClaw и продуктовым ботом (`npm run dev` в `telegram-user`):

1. В **`openclaw/.env`** оставьте **`TELEGRAM_BOT_TOKEN=`** пустым (без токена).
2. В **`%USERPROFILE%\.openclaw\openclaw.json`** выставьте **`channels.telegram.enabled`: `false`** — иначе gateway при старте требует секрет `TELEGRAM_BOT_TOKEN` и падает с `SecretRefResolutionError`, даже если канал не нужен.
3. Токен бота укажите **только** в **`telegram-user/.env`** → `PRODUCT_BOT_TOKEN`.
4. Запускайте **`.\scripts\start-gateway.ps1`** — поднимутся gpt2giga и **HTTP gateway** на **:18789**; OpenClaw не поднимает Telegram-канал и не конфликтует с продуктом.
5. Если в глобальном **`~/.openclaw/.env`** всё ещё прописан тот же бот — уберите там `TELEGRAM_BOT_TOKEN`, иначе при снова включённом канале OpenClaw снова начнёт polling.

Пишите в Telegram **продуктовому** боту — меню «Мои чаты», «Автоответы» и т.д. Pairing OpenClaw в том же чате при этой схеме не появляется.

## 5. Запуск для отладки

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\start-gateway.ps1
```

Проверка: `openclaw gateway status` (в другом окне), затем в Telegram — написать боту (при необходимости пройти pairing по коду).

Отдельно только обновить токен и увидеть команды:

```powershell
.\scripts\refresh-gigachat-token.ps1
```

## 6. Ограничения

- **GigaChat** и **Telegram** должны быть доступны по HTTPS с вашей сети; на некоторых сетях нужен обход блокировок.
- OpenClaw **не входит** в этот репозиторий как npm-зависимость — тянется через `npx` при запуске.
- Точные имена флагов CLI могут меняться; при ошибке смотрите `npx openclaw@latest --help` и [docs.openclaw.ai](https://docs.openclaw.ai).

### Windows + TLS к `gigachat.devices.sberbank.ru`

Node по умолчанию использует свой набор CA и может выдавать `SELF_SIGNED_CERT_IN_CHAIN` к API Сбера. Решение: **`NODE_OPTIONS=--use-system-ca`** (в `~/.openclaw/.env` скрипт `apply-env-to-openclaw.ps1` добавляет строку; в **`~/.openclaw/openclaw.json`** добавлен блок **`env.NODE_OPTIONS`**).

**gpt2giga (Python)** к тем же хостам ходит через `httpx` и может выдавать **`SSL: CERTIFICATE_VERIFY_FAILED` / self-signed certificate in chain** при стриминге ответа в Telegram. Скрипт `start-gpt2giga.ps1` по умолчанию на Windows выставляет **`GIGACHAT_VERIFY_SSL_CERTS=False`** в `.gpt2giga.runtime.env`; при необходимости задайте в `openclaw/.env` явно **`GIGACHAT_VERIFY_SSL_CERTS=true`** и настройте доверие (корпоративный CA / `GIGACHAT_CA_BUNDLE_FILE` в [доке GigaChat Python](https://github.com/ai-forever/gigachat)).

### Совместимость агента OpenClaw с GigaChat

Прямой кастом-провайдер к GigaChat может отвечать **HTTP 400** на запросы полноформатного агента (большой системный промпт, формат сообщений, поля, отличные от «чистого» `chat/completions`). В логах/CLI это часто выглядит как **`400 status code (no body)`**, при этом простой `POST .../chat/completions` с коротким сообщением через тот же токен может работать. Варианты: [прокси gpt2giga](https://developers.sber.ru/ru/gigachain/tools/utilities/gpttogiga-proxy-server), другой LLM в OpenClaw для тестов, или WSL2 по [документации OpenClaw для Windows](https://docs.openclaw.ai/platforms/windows). В `~/.openclaw/openclaw.json` не держите вторую модель **`GigaChat-2`**, если API её не отдаёт — оставьте только **`GigaChat`**.

**Telegram-канал** при этом может быть **включён и зелёным** в `openclaw status` — проверьте бота в Telegram; ответы появятся после того, как заработает выбранная модель.

### telegram-user (v1 задачи и привязка к `appUserId`)

Сервис **`telegram-user`** (порт по умолчанию **4050**) отдаёт REST для задач/напоминаний и таблицу **`TgBotUserBinding`**: Telegram user id → `appUserId`. В **`openclaw/.env`** задайте **`TELEGRAM_USER_BASE_URL`** и **`TELEGRAM_USER_AGENT_TOKEN`** (как **`PORT`** / **`AGENT_API_TOKEN`** в `telegram-user/.env`), затем **`.\scripts\apply-env-to-openclaw.ps1`** — переменные допишутся в **`%USERPROFILE%\.openclaw\.env`**.

**Интеграция с агентом OpenClaw:** встроенный **`web_fetch` не ходит на `127.0.0.1`**, поэтому агент вызывает API через **`exec`** + скрипт **`invoke.ps1`**. Один раз установите скилл в профиль OpenClaw:

```powershell
cd D:\Python\Github\VPN_service\openclaw
.\scripts\install-telegram-user-skill.ps1
```

Инструкции для модели: **`openclaw/skills/telegram-user/SKILL.md`** (копируется в **`%USERPROFILE%\.openclaw\skills\telegram-user\`**). После установки перезапустите gateway.

Подробнее: [telegram-user/docs/V1-OPENCLAW.md](../telegram-user/docs/V1-OPENCLAW.md). Смоук API: `.\scripts\test-telegram-user-bindings.ps1`. Смоук **`invoke.ps1`**: `.\scripts\test-telegram-user-invoke.ps1`. Диалоги (**`account-for-app`** → **`dialogs-list`**): `.\scripts\test-telegram-user-dialogs.ps1` (нужен **`TgAccount`** после `connector/login.py` + **`worker.py`**; иначе скрипт корректно пропускает).

**Операционный чеклист (локально):**

1. В **`openclaw/.env`**: **`TELEGRAM_USER_BASE_URL`**, **`TELEGRAM_USER_AGENT_TOKEN`** (= **`AGENT_API_TOKEN`** в `telegram-user/.env`).
2. **`.\scripts\apply-env-to-openclaw.ps1`** — подмешивает переменные в **`%USERPROFILE%\.openclaw\.env`**.
3. **`npm run dev`** (или `tsx src/server.ts`) в каталоге **`telegram-user`** — API на **4050**.
4. **`.\scripts\install-telegram-user-skill.ps1`** — скилл в **`%USERPROFILE%\.openclaw\skills\telegram-user`**.
5. Привязка Telegram id → `appUserId`: **`.\scripts\seed-telegram-binding.ps1 -TelegramUserId "<id>" -AppUserId "<id продукта>"`** (id из логов: `openclaw logs --follow`, поле **`from.id`** в личке с ботом).
6. Политика инструментов: для вызова **`invoke.ps1`** через **`exec`** нужен профиль не **`minimal`**. Рекомендуется **`tools.profile`: `full`** (например `openclaw config set tools.profile full`), затем **перезапуск gateway**.
7. Перезапуск **`.\scripts\start-gateway.ps1`** после смены **`.env`** или **`openclaw.json`**.

### Comrade (этот репозиторий)

Бэкенд **Comrade** отвечает в Telegram через `POST /v1/chat/completions` на OpenClaw Gateway. Ключи **GigaChat** остаются здесь (`GIGACHAT_*`, gpt2giga); в Comrade они **не** копируются.

#### Где взять `OPENCLAW_GATEWAY_TOKEN` и куда вписать

Это **не** ключ GigaChat и не токен Telegram-бота. Это **общий секрет доступа к самому OpenClaw Gateway** (как пароль к Control UI и HTTP API). Его задаёт OpenClaw при настройке; см. [OpenAI Chat Completions — Authentication](https://docs.openclaw.ai/gateway/openai-http-api#authentication).

1. **Посмотреть в конфиге** (Windows): файл **`%USERPROFILE%\.openclaw\openclaw.json`**. Внутри секция **`gateway.auth`**: при режиме **`token`** нужна строка **`gateway.auth.token`**. Если там подстановка вида **`"${OPENCLAW_GATEWAY_TOKEN}"`**, тогда значение лежит в **`%USERPROFILE%\.openclaw\.env`** в переменной **`OPENCLAW_GATEWAY_TOKEN`** (или экспортируйте её сами перед запуском gateway).
2. **Если токена нет** — пройдите **`openclaw onboard`** (мастер обычно генерирует токен) или задайте **`gateway.auth.mode`: `"token"`** и **`gateway.auth.token`** вручную в `openclaw.json` / через документацию [Gateway configuration](https://docs.openclaw.ai/gateway/configuration-reference#gateway-field-details).
3. **Comrade** может подставить токен **сам**: при старте бэкенд читает **`%USERPROFILE%\.openclaw\.env`** и **`openclaw.json`** и выставляет `OPENCLAW_GATEWAY_TOKEN` / URL, если вы их не задали в `comrade/backend/.env`. Ручное копирование не обязательно.
4. Либо **скопируйте** значение в **`OPENCLAW_GATEWAY_TOKEN`** в **`openclaw/.env`** репозитория или **`comrade/backend/.env`**. URL: **`OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`** (или порт из `gateway.port`).
5. **Проверка** (gateway запущен, chat completions включены в конфиге):

```powershell
curl.exe -sS "http://127.0.0.1:18789/v1/models" -H "Authorization: Bearer ВАШ_ТОКЕН"
```

Ожидается JSON со списком моделей (например `openclaw/default`), не `401`.

В Comrade для gateway задайте **`OPENCLAW_CHAT_MODEL=openclaw/default`** (или другой `openclaw/<agentId>`); провайдер GigaChat задаётся в агенте здесь, в `openclaw.json`, а не строкой `GigaChat` в поле `model` HTTP API.

### `409 Conflict` (getUpdates) в логах

Два **одновременных** запроса `getUpdates` с **одним токеном** (Telegram так не разрешает). Варианты:

1. **На этом ПК** — несколько `openclaw gateway` / несколько терминалов. Остановите только OpenClaw и освободите порты:

```powershell
cd D:\Python\Github\VPN_service\openclaw\scripts
.\stop-openclaw-processes.ps1
.\stop-all-openclaw-node.ps1
```

2. **Другой компьютер / VPS / контейнер** с тем же `TELEGRAM_BOT_TOKEN` — остановите там бота или смените токен.

3. **Сброс токена у @BotFather** — команда `/revoke` для бота выдаёт новый токен; старые сессии опроса перестают действовать. Подставьте новый токен в `openclaw/.env`, снова `.\apply-env-to-openclaw.ps1`.

4. Перед запуском можно снять webhook (если когда-то включали): `.\telegram-delete-webhook.ps1`. Полный цикл: `.\restart-gateway-clean.ps1`.

Проверка **исходящих** сообщений (без `getUpdates`): `.\send-telegram-test.ps1` — шлёт «Привет» в личку по `allowFrom` из `~/.openclaw/credentials/`.

### `404` вместо ответа бота

Часто это **не Telegram**, а **GigaChat**: клиент OpenClaw обращается к пути, которого нет на совместимом API (или указана модель вроде `GigaChat-2`, которую ваша подписка/эндпоинт не отдаёт). В `~/.openclaw/openclaw.json` для основной модели попробуйте **`custom-.../GigaChat`** (без `-2`). Если 404 остаётся — смотрите лог `%TEMP%\openclaw\openclaw-*.log` и раздел про совместимость выше.
