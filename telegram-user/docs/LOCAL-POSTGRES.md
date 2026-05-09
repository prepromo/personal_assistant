# Локальный PostgreSQL для `telegram-user`

Схема Prisma настроена на **PostgreSQL** (`DATABASE_URL` должен начинаться с `postgresql://` или `postgres://`).

## Вариант 1: Docker (рекомендуется)

1. Установите [Docker Desktop](https://www.docker.com/products/docker-desktop/) для Windows и **запустите** его (движок должен быть активен).
2. Из каталога `telegram-user`:

```powershell
docker compose up -d postgres
npx prisma migrate deploy
```

3. В `.env` (см. `.env.example`):

`DATABASE_URL=postgresql://tguser:tguser@127.0.0.1:5433/tguser`

Порт **5433** на хосте проброшен из контейнера (см. `docker-compose.yml`).

Скрипт **`scripts/start-tg-stack.ps1`** в корне репозитория сам пытается выполнить `docker compose up -d postgres` и `prisma migrate deploy` перед запуском API.

## Вариант 2: PostgreSQL без Docker

Установите PostgreSQL локально, создайте пользователя и БД, затем укажите в `.env` свой URL, например:

`postgresql://USER:PASSWORD@127.0.0.1:5432/DBNAME`

После этого выполните `npx prisma migrate deploy` в каталоге `telegram-user`.

## Типичная ошибка

`Error validating datasource db: the URL must start with the protocol postgresql://` — в `.env` остался старый SQLite (`file:./tg-user.db`). Замените на строку PostgreSQL и поднимите сервер БД.

`WinError 10054` / `httpx.ReadError` у воркера — API обрывает соединение, чаще всего из‑за той же ошибки Prisma при старте. Сначала исправьте БД и перезапустите стек.
