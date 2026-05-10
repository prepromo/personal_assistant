# Развёртывание telegram-user

## «Динамический сайт» на своём сервере — это уже здесь

Сервис **не статический генератор**, а **Node.js (Express)**:

- **`/`** — лендинг из `public/index.html`, если он есть (обычно собирается из `prepromo-landing`);
- **`/cabinet.html`**, **`/connect.html`**, **`/mvp.html`** и остальное из **`telegram-user/public/`** отдаёт `express.static`;
- **`/api/v1/…`** — кабинет, авторизация, биллинг, MTProto и т.д.

То есть **один процесс** = и страницы «сайта», и бэкенд. Отдельно поднимаете только **PostgreSQL**, при желании **worker** (`connector/worker.py`) и в проде — **HTTPS-прокси** перед портом 4050.

### Минимальный прод-путь

1. **VPS** (Ubuntu и т.п.), установить Docker или Node 22 + systemd.
2. Клонировать репозиторий, в **`telegram-user/.env`** задать как минимум:
   - `DATABASE_URL` — Postgres на этом же сервере или управляемый.
   - `SESSION_ENCRYPTION_KEY`, `CONNECTOR_SECRET`, секреты бота и т.д. по вашему `README`.
   - **`PRODUCT_PUBLIC_BASE_URL=https://ваш-домен.ru`** — **обязательно для кнопок `/connect` в боте** и корректного редиректа после Telegram Login Widget (без слэша в конце).
3. **`npx prisma migrate deploy`** перед первым запуском API.
4. **`npm ci`** → **`npm run start`** (или Docker см. ниже).
5. Перед прокси: API слушает **`4050`** (или свой `PORT`).

HTTPS обычно так:

- **Caddy** или **nginx** на `:443` → прокси на `127.0.0.1:4050`, сертификат Let's Encrypt.
- В @BotFather для виджета: **`/setdomain`** → тот же `ваш-домен.ru`.

Лендинг обновить: из корня монорепо **`npm run build:landing`** в `telegram-user` (если используете препромо) либо положить свой **`public/index.html`** рядом с API. Сборка препромо подставляет кнопки **Подключить** и **Кабинет** со ссылками **`/connect.html`** и **`/cabinet.html`** (один origin с API). Если лендинг собираете под другой базовый URL, задайте в **`prepromo-landing`** при сборке **`VITE_SITE_CONNECT_URL`** и **`VITE_SITE_CABINET_URL`** (полные URL).

### Docker из репозитория

```bash
cd telegram-user
# создайте .env рядом (DATABASE_URL для postgres из compose можно переопределить)
docker compose up -d --build
```

Проксируйте **порт контейнера 4050** на ваш домен с HTTPS. В compose передайте **`PRODUCT_PUBLIC_BASE_URL`** через `environment` или `env_file`.

### Render.com и похожие PaaS

Если «перейти с GitHub Pages на Render», нужно понимать тип сервиса:

| Тип на Render | Эффект |
|---------------|--------|
| **Static Site** | Только раздача файлов — **без Node.js API**. Это как GitHub Pages: **`/connect.html` и `/api/v1/…` работать не будут**, если вы не пропишете `window.__CABINET_API_ORIGIN__` на отдельный API и **CORS**. |
| **Web Service** (Node) | **Это то, что нужно:** один процесс `telegram-user`, статика из `public/` + Express API на том же URL (Render задаёт **`PORT`** — в коде уже используется `process.env.PORT` или 4050). |

На Render дополнительно:

1. Создать **PostgreSQL**, в переменные Web Service положить **`DATABASE_URL`** (из панели БД).
2. Root Directory репозитория указать **`telegram-user`** (если монорепо).
3. Build: `npm ci && npx prisma generate`; Start: `npx prisma migrate deploy && npm run start`.
4. Все секреты из `.env` введены в **Environment** сервиса.
5. **`PRODUCT_PUBLIC_BASE_URL`** = публичный URL этого же Web Service, например `https://имя-сервиса.onrender.com` (без слэша в конце).

**Worker** (Pyrogram) на одном бесплатном Web Service часто не запускают — второй сервис (**Background Worker**) или VPS только под коннектор.

На бесплатном тарифе Web Service «засыпает» без запросов — для прод-бота иногда берут платный тариф или VPS.

### Если хотите «статику отдельно» от API

Тогда HTML лежит на другом origin (например Pages), а в странице перед скриптом задаётся `window.__CABINET_API_ORIGIN__='https://api.ваш-домен.ru'` и на API в **`CORS_ORIGINS`** перечислен origin статики. Проще для продукта — **не делить**, всё на одном домене с API.

---

## Можно ли использовать GitHub Pages?

**Нет — как единственный хост для всего сервиса.** [GitHub Pages](https://pages.github.com/) отдаёт только **статические файлы** (HTML/CSS/JS). Здесь нужны:

- долгоживущий **Node.js** процесс (Express, Prisma, автоответы);
- при необходимости **Python worker** (Pyrogram);
- **БД** — **PostgreSQL** (`DATABASE_URL`);
- для LLM — отдельный процесс или внешний API;
- **продуктовый бот** делает long polling к Telegram — это тоже серверный процесс.

**Частично:** можно выложить на GitHub Pages только **статическую витрину** или копию `public/cabinet.html`, если API крутится **на другом хосте** (VPS, Railway, Fly.io и т.д.) и в `.env`/`CORS` указан публичный URL API. Само приложение без бэкенда на Pages работать не будет.

## Варианты развёртывания бэкенда

| Вариант | Плюсы | Минусы |
|--------|--------|--------|
| **VPS** (Ubuntu, Hetzner, Timeweb, …) | Полный контроль, worker + Node на одной машине | Нужна настройка systemd, HTTPS, секреты |
| **PaaS** (Railway, Render, Fly.io) | Простой деплой из git | Часто один контейнер — worker может понадобиться отдельным сервисом |
| **Docker** | Воспроизводимость | См. `docker compose` в репозитории (если есть) |

Минимальный набор процессов в проде:

1. `npm run start` (или `node`) для `telegram-user` с переменными из `.env`.
2. `prisma migrate deploy` перед стартом.
3. **Worker** `connector/worker.py` на той же машине или отдельно (нужен доступ к API и сессии MTProto).
4. **LLM:** gpt2giga/OpenAI-совместимый endpoint или gateway — URL в `.env`.

HTTPS для публичного webhook бота не обязателен при **polling**; для **webhook** нужен HTTPS URL.

## Локальный запуск (разработка)

См. корневой [README.md](../../README.md) и [README.md](../README.md): `docker compose` (Postgres), `npx prisma migrate deploy`, `connector/login.py`, `.\scripts\start-worker.ps1`.

## Секреты

Не коммитьте `.env`. На сервере задайте переменные через панель хостинга или `systemd` `EnvironmentFile`.

## Продуктовый бот

Меню: **Агенты**, **Заметки**, **Новости**, **Помощь**, **Режим чатов**; напоминания, при настройках — NL-команды и deep links (`PRODUCT_BOT_USERNAME`). Автоответы в личных чатах — worker + LLM (см. [AUTOMATION.md](AUTOMATION.md)), [USER-GUIDE.md](USER-GUIDE.md).
