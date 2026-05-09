# Запуск продуктового бота (локально)

## Переменные

См. `telegram-user/.env.example` — блок **Продуктовый бот (MVP)**.

Обязательно:

- `PRODUCT_BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather).

Опционально:

- `BOT_MODE` — `polling` (по умолчанию, удобно без HTTPS) или `webhook`.
- `PRODUCT_BOT_WEBHOOK_SECRET` — если webhook: тот же секрет, что при `setWebhook` (`secret_token`).

## Связка с личным аккаунтом (MTProto)

После успешного **`python login.py`** коннектор вызывает `POST /internal/link-telegram-user-to-account`: числовой Telegram user id привязывается к **`TgAccount.appUserId`** из `APP_USER_ID`. Продуктовый бот тогда использует **тот же** `appUserId`, что и агент/кабинет (задачи и напоминания общие). Данные, созданные до входа под гостевым `bot-<id>`, переносятся на канонический id.

## Локальный сценарий (polling)

1. Скопируйте `.env.example` → `.env`, задайте `PRODUCT_BOT_TOKEN`.
2. `npx prisma migrate deploy` (или уже применено).
3. `npm run dev` в каталоге `telegram-user`.
4. В логах: `Product bot @YourBot — getUpdates (polling)`.
5. В Telegram откройте бота → `/start`.
6. Проверьте:
   - «Новая задача» → текст → задача в БД (`Task` с `appUserId` = `bot-<ваш_id>`).
   - Перешлите сообщение из любого чата → строка в `BotConnectedChat`.
   - «➕ Напоминание» → `+2` → заголовок → текст → через ~2 мин придёт сообщение от бота (если `PRODUCT_BOT_TOKEN` валиден).

## Webhook (прод)

1. Публичный HTTPS URL, например `https://your.domain/api/v1/bot/webhook`.
2. Установите webhook:

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL>&secret_token=<SECRET>
```

3. В `.env`: `BOT_MODE=webhook`, `PRODUCT_BOT_WEBHOOK_SECRET=<SECRET>`.
4. **Не** запускайте polling одновременно с webhook.

## Проверки

- `GET http://127.0.0.1:4050/health` — поле `productBot.configured` и `mode`.
- SQLite: таблицы `TgBotUserBinding`, `BotConnectedChat`, `Task`, `Reminder`.

## End-to-end чеклист

| Шаг | Ожидание |
|-----|----------|
| /start | Приветствие + reply-клавиатура |
| Мои чаты (пусто) | Текст про пересылку |
| Forward из канала | Чат в списке |
| Новая задача + текст | Ответ «Задача создана» |
| Напоминание +2 мин | Сообщение в личку от бота в срок |
