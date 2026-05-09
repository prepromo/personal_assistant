# Развёртывание telegram-user

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
