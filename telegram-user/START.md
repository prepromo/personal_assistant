# Уже сделано автоматически

- Зависимости Node, Prisma, миграции
- Аккаунт в БД (`ensure-account`), id в файле **`.last-account-id`**
- Python venv в **`connector/.venv`**, пакеты из **`requirements.txt`**
- API **http://127.0.0.1:4050** (если окно `npm run dev` ещё открыто)

# Осталось только тебе (2 минуты)

1. Открой **https://my.telegram.org/apps** → создай приложение → скопируй **api_id** и **api_hash** (это не токен бота и не хранится в репозитории). В `login.py` при запросе номера вводи **телефон** (`+7…`), **не** токен из @BotFather — иначе воркер упадёт с `BOT_METHOD_INVALID`. Если так вышло: `.\scripts\reset-telegram-session.ps1`, удали файлы в `connector/sessions/`, снова `run-telegram.ps1`.

2. В PowerShell из каталога **`telegram-user`**:

```powershell
.\scripts\set-telegram-api.ps1 -ApiId ВАШ_ID -ApiHash ВАШ_HASH
.\scripts\run-telegram.ps1
```

3. В консоли **`login.py`** введи телефон и код из Telegram, затем пойдёт **`worker.py`** (синк + входящие).

Остановка воркера: **Ctrl+C**. API останавливается в отдельном окне **Ctrl+C** там.

Полный сценарий тестового MVP (браузер, опционально вход по HTTP): **`docs/MVP-RUNBOOK.md`**. Панель: **http://127.0.0.1:4050/mvp.html** (после `npm run dev`).
