# Отладка продуктового бота (чеклист)

1. **Миграции:** `npx prisma migrate deploy` и `npx prisma generate` в каталоге `telegram-user`.
2. **Агенты:** создать до 5 агентов в боте или через `POST /v1/app-users/:appUserId/product-agents`; шестой — отклонён с ошибкой.
3. **Привязка диалога:** в разделе агента «Назначить чаты» выбрать диалог; в логах при автоответе искать `[productAgent] resolve:` и `merged agent=`.
4. **Автоответ:** политика suggest/auto, worker, LLM; очередь `TgAutomationJob` с полем `productAgentId` при наличии агента.
5. **Заметки / напоминания:** «Заметки» → текст; напоминание — заголовок, текст, минуты; срабатывание — `reminderScheduler` и `[newsDigest]` не относится.
6. **Новости MTProto:** подписка на диалог, в БД есть `TgMessage` после worker; кнопка «Собрать новости сейчас».
7. **Новости Bot API:** чат в `BotConnectedChat`, бот в группе/канале; в логах `[botChannelIngest]`; записи в `BotChannelPost`; подписка `bot_chat`.
8. **Лог-префиксы:** `[productAgent]`, `[newsDigest]`, `[botChannelIngest]`; при шуме пропусков автоответа — `AUTOMATION_SKIP_LOG=1`.

Переменная **`NEWS_DIGEST_POLL_MS`** (по умолчанию 900000): период фонового дайджеста новостей.
