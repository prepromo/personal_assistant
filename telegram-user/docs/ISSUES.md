# Следующие шаги (как тикеты)

## Epic: Коннектор MTProto (MVP)

- [x] **TU-1** Pyrogram (см. `connector/requirements.txt`).
- [x] **TU-2** `connector/login.py`, `connector/worker.py`.
- [x] **TU-3** `login.py` + `POST /internal/session` (шифрование `SESSION_ENCRYPTION_KEY` на Node).
- [x] **TU-4** Запись через `POST /internal/ingest/dialog` и `ingest/message`.

## Epic: API Gateway

- [x] **TU-5** Express в `src/server.ts`, секрет коннектора `X-Connector-Secret`, агент `Bearer AGENT_API_TOKEN`.
- [x] **TU-6** Реализованы диалоги, сообщения, send (очередь), read (локально в БД).
- [x] **TU-7** Policy через `policyJson` на `TgAccount` (`sendAllowed`, `markReadAllowed`).

## Epic: Очередь и надёжность

- [ ] **TU-8** Подключить Redis + BullMQ (или in‑memory очередь для dev) для буфера updates от коннектора.
- [ ] **TU-9** Idempotent upsert сообщений по `(dialogId, tgMessageId)`.

## Epic: Интеграция

- [ ] **TU-10** Документировать выдачу service token для OpenClaw; пример OpenClaw tool → `curl` к API.
- [ ] **TU-11** Опционально: связка `appUserId` с Comrade `User.id` и SSO (JWT).

## Epic: Production

- [ ] **TU-12** Миграция БД на PostgreSQL; `sessionEnc` + ключи в KMS.
- [ ] **TU-13** Оценка миграции коннектора на TDLib (ADR).

## Epic: Тесты

- [ ] **TU-14** Контрактные тесты API по OpenAPI.
- [ ] **TU-15** Мок коннектора (фикстуры) для CI без реального Telegram.
