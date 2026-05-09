# VPN_service — стек PrePromo / личный Telegram + LLM

Публичная витрина первого этапа: **[prepromo.online](https://prepromo.online)** (лендинг и ссылка на бота). Этот репозиторий — **бэкенд и инструменты**: веб-кабинет, API, **продуктовый Telegram-бот**, опционально **личный аккаунт (MTProto)** для автоответов от вашего имени.

## Что внутри (коротко)

| Часть | Назначение |
|--------|------------|
| **`telegram-user/`** | Node (Express), **PostgreSQL** (Prisma), продуктовый бот, автоматизация, кабинет. |
| **`prepromo-landing/`** | Официальный лендинг (Vite + TanStack Start, [исходник на GitHub](https://github.com/GEBS-1/prepromo-your-telegram-helper)). Сборка в статику API: `cd telegram-user && npm run build:landing` → файлы в `telegram-user/public/`, корень сайта **`/`** отдаёт `index.html`. |
| **`openclaw/`** | Gateway и сценарии LLM (GigaChat и др.). |
| **`scripts/start-tg-stack.ps1`** | Локальный запуск связки (Windows). |
| **`connector/`** (внутри `telegram-user`) | Python: вход в личный Telegram и воркер синхронизации. |

**Два сценария использования:**

1. **Только бот** — пользователи пишут вашему боту в Telegram: меню (агенты, заметки, напоминания, новости, режим чатов), без подключения личного аккаунта.
2. **Бот + личный Telegram** — после входа через коннектор с тем же `appUserId` доступны автоответы в обычных чатах (worker + LLM). Настройка сложнее; для первых демо часто достаточно сценария 1.

База данных по умолчанию в проекте — **PostgreSQL** (`DATABASE_URL`). Локально проще всего: `docker compose` в каталоге `telegram-user` (сервис `postgres` на порту **5433** с хоста).

## Быстрый старт (разработчик)

1. Секреты: `openclaw/.env` (LLM), `telegram-user/.env` из **`telegram-user/.env.example`** — задайте **`DATABASE_URL`**, секреты, при необходимости **`PRODUCT_BOT_TOKEN`**.
2. БД: `cd telegram-user && docker compose up -d postgres` → `npx prisma migrate deploy` → `npm install` → `npm run dev`.
3. Полная пошаговая инструкция (GigaChat, gateway, бот): **[RUNBOOK.md](./RUNBOOK.md)**.
4. Пользовательская справка по боту: **`telegram-user/docs/USER-GUIDE.md`**. Развёртывание на сервере: **`telegram-user/docs/DEPLOY.md`**.

**Одной командой на Windows** (корень репозитория, после `npm install` в корне):

`.\scripts\start-tg-stack.ps1`  

Варианты: `-NoWorker`, `-DesktopWindows` — см. комментарии в скрипте.

**Запуск только из терминала (в т.ч. встроенный в Cursor):** см. **[TERMINAL-RUN.md](./TERMINAL-RUN.md)** — там `Start.ps1` / `StartCode.ps1`, режим `Deps` + `FullHere`, и отличие от режима с новыми окнами.

Мини-дашборд (если поднят `local-saas`): `http://127.0.0.1:3090/status.html`.

## Миграция с SQLite (если у вас был старый `tg-user.db`)

Схема переведена на **PostgreSQL**. Старый файл SQLite напрямую не подключается: поднимите Postgres, выполните `npx prisma migrate deploy` и при необходимости перенесите данные вручную или начните с чистой БД.

## Документация

| Файл | Содержание |
|------|------------|
| [RUNBOOK.md](./RUNBOOK.md) | Подробный локальный запуск всего стека |
| [telegram-user/README.md](./telegram-user/README.md) | API, коннектор, воркер |
| [telegram-user/docs/PRODUCT-CHECKLIST.md](./telegram-user/docs/PRODUCT-CHECKLIST.md) | Чеклист готовности |

Цель «день 1» в одной фразе: **поднять у себя веб-чат с GigaChat и при желании Telegram-бота**, без обязательного домена и оплаты — дальше витрина и прод на **prepromo.online** и своём VPS.
