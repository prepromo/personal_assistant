# Автоответы с личного аккаунта (replyMode + LLM)

**Обновление:** массовый **автоответ в MTProto** (генерация исходящих на каждое входящее) **отключён** в коде. Вместо этого для чатов с **явной привязкой к ProductAgent** (`ProductAgentDialog`) работает **отчёт владельцу в продуктовый бот** без отправки собеседнику — см. `src/lib/agentInboundReport.ts` и переменные `AGENT_INBOUND_REPORT*` в `.env.example`.

## Условия

1. Запущены **telegram-user API**, **connector** (`login.py` + **`worker.py`**), чтобы сообщения попадали в БД (`ingest/message`).
2. В **`telegram-user/.env`** настроен LLM (см. `src/lib/llm/chatCompletion.ts`):
   - **Рекомендуется для «простого» ответа GigaChat:** **`OPENAI_BASE_URL=http://127.0.0.1:8090/v1`**, **`OPENAI_API_KEY`** (как у gpt2giga, напр. `sk-openclaw-gpt2giga-local`), **`OPENAI_CHAT_MODEL=GigaChat`**. Должен быть запущен **gpt2giga** (часто вместе с `openclaw/scripts/start-gateway.ps1`).
   - **OpenClaw gateway :18789** (`OPENCLAW_GATEWAY_*`): HTTP API принимает в поле `model` только **`openclaw`** или **`openclaw/<agentId>`**. Строки вида `custom-…/GigaChat` дают **400 Invalid model** — для них используйте прямой **gpt2giga** выше, без gateway.
   - **GigaChat:** прямого вызова API Сбера из `telegram-user` нет; используется OpenAI-совместимый слой (gateway или gpt2giga).
3. В политике аккаунта **`replyMode`**:
   - **`manual`** — автоответы выключены (по умолчанию).
   - **`suggest`** — на каждое входящее создаётся задание; текст ответа пишется в **аудит** (`automation_suggestion_text`), в Telegram **не уходит**.
   - **`auto`** — текст генерируется и ставится в **`TgPendingSend`**; **worker** отправляет через Pyrogram.

## “Написать первым” vs автоответ

В продукте есть две разные автоматизации:

- **Автоответ**: срабатывает **только на входящее** сообщение собеседника (через `TgAutomationJob`). Зависит от `replyMode` и allowlist.
- **“Написать первым” (outreach)**: это **исходящее по инициативе пользователя**. Сообщение ставится в очередь `TgPendingSend` только если в запросе/команде есть явный текст первого сообщения (`first_message` / “Напиши им первым: …” / “напиши пользователю … и …”). Отправляет **только worker**.

Если собеседник ещё не писал — автоответ не сработает. Для первого пинга нужен outreach.

## Отчёт владельцу (mission met)

Опционально можно включить проверку “цель агента выполнена” по последней реплике собеседника (второй вызов LLM перед генерацией ответа).

- Включение: `AUTOMATION_MISSION_EVAL=1`
- Порог “можно делать побочные эффекты”: `AUTOMATION_MISSION_MET_CONFIDENCE` (по умолчанию 0.65)
- Результат используется так:
  - добавляется в system промпт автоответа (чтобы агент подтвердил выполнение / уточнил детали)
  - при `missionMet=true` с высокой уверенностью:
    - создаётся **UserNote** владельцу
    - пишется запись в аудит `automation_mission_met`
    - если у пользователя **ровно одна** открытая Task — она переводится в `done`
    - если есть `TgBotUserBinding`, владельцу приходит **сообщение в чат с продуктовым ботом** (“✅ Выполнено …”)

Политику можно менять в **кабинете** (`cabinet.html`) или через API агента: **`PATCH /v1/accounts/:accountId/policy`** с телом `{ "replyMode": "auto" }` и заголовком **`Authorization: Bearer <AGENT_API_TOKEN>`**.

Из чата с **ботом OpenClaw** — действие **`policy-patch`** в скилле **`invoke.ps1`** (см. `openclaw/skills/telegram-user/SKILL.md`).

## Обработка

Фоновый цикл в **`server.ts`** (интервал **`AUTOMATION_POLL_MS`**, по умолчанию 4000 ms) вызывает **`processAutomationJobsOnce`** — по одному заданию за раз, статусы `pending` → `processing` → `done` / `failed` / `skipped`.

Исходящий текст в Telegram (режим **auto**) и запись в аудите (**suggest**) начинаются со строки **`Отвечает Агент`** (переменная **`AUTOMATION_AGENT_LABEL`**, затем пустая строка, затем текст модели). Длина и «сухость» ответа настраиваются **`AUTOMATION_MAX_TOKENS`** (по умолчанию 512) и **`AUTOMATION_TEMPERATURE`** (по умолчанию 0.35).

## Безопасность

Режим **`auto`** рассылает ответы от вашего имени. Используйте **`suggest`** для проверки качества, затем **`manual`** или отключайте отправку через **`sendAllowed: false`** в политике при необходимости.

## Диагностика: job не создаётся / «агент молчит»

1. **`replyMode`** по умолчанию **`manual`** — автоответы **не ставятся в очередь**, пока в кабинете или боте не выберете **`suggest`** или **`auto`**.
2. При **`agentScope: allowlist`** диалог должен быть **в списке** (кабинет → «Сохранить список для агента»), иначе входящие игнорируются.
3. В логах `npm run dev` включите **`AUTOMATION_SKIP_LOG=1`** в `.env` — будут строки `[automation] skip: …` с причиной.
4. **GET** `http://127.0.0.1:4050/internal/automation-debug?appUserId=ВАШ_APP_USER_ID` с заголовком **`X-Connector-Secret`** (= `CONNECTOR_SECRET` из `.env`) — вернёт политику, последние `TgAutomationJob` и причину пропуска для `&dialogId=<uuid>`.

## Диагностика: `failed` / `fetch failed` в `TgAutomationJob`

1. Убедитесь, что **`replyMode`** не `manual` и при **allowlist** диалог разрешён.
2. Проверьте, что целевой LLM **доступен с той же машины**, где `npm run dev`:
   - Gateway **18789** — процесс OpenClaw запущен; `openclaw health --json`.
   - Только **gpt2giga 8090** — в `telegram-user/.env` **не** задавайте `OPENCLAW_*`, задайте `OPENAI_BASE_URL` и ключ; прокси запущен.
3. После правок `.env` перезапустите **telegram-user**. Текст ошибки в БД теперь развёрнутый (`LLM fetch: … endpoint …` + подсказка).
