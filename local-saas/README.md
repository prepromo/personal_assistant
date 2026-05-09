# Local OpenClaw (тестовая витрина)

Локальная имитация продуктового сайта и кабинета (как у коммерческого OpenClaw): **лендинг**, **кабинет с чатом**, выбор **моделей** (из gpt2giga), переключатель **GigaChat (gpt2giga)** / **OpenClaw gateway**, страницы **каналы**, **агент** (черновик роли в `localStorage`), **тарифы (мок)**.

## Одна команда (из корня `VPN_service`)

```powershell
.\scripts\start-local-saas.ps1
```

1. Запускает **gpt2giga** на `http://127.0.0.1:8090/v1` (нужен `openclaw/.env` с GigaChat).
2. Поднимает портал на **http://127.0.0.1:3090/**

## URL

| Путь | Описание |
|------|----------|
| `/` | Лендинг |
| `/dashboard.html` | Чат, провайдер, модель |
| `/channels.html` | Как подключить Telegram-бота (OpenClaw) |
| `/agent.html` | Черновик SOUL → подмешивается в системный промпт чата |
| `/docs.html` | Ссылки на документацию |
| `/subscription.html` | Мок тарифов |
| `/status.html` | Дашборд статусов (gpt2giga, gateway, опционально telegram-user) |

Полный сценарий от нуля: **[../RUNBOOK.md](../RUNBOOK.md)**.

## Настройка

- Скопируйте `local-saas/.env.example` → `local-saas/.env`.
- **Вход по умолчанию отключён** (`LOCAL_SAAS_SKIP_AUTH` не `0`). Включить логин: `LOCAL_SAAS_SKIP_AUTH=0`, затем `npm run seed:test-user` (логин `test@local.dev` / `test123456`) или регистрация на `/register.html`.
- **OpenClaw в чате:** задайте `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN` (и при необходимости `OPENCLAW_CHAT_MODEL`) — как в `telegram-user` / `~/.openclaw/openclaw.json`. Тогда в кабинете можно выбрать провайдер «OpenClaw gateway».

## Стек

| Компонент | Роль |
|-----------|------|
| **local-saas** | Лендинг + кабинет + прокси чата |
| **gpt2giga** | GigaChat в формате OpenAI API |
| **OpenClaw gateway** | Опционально — тот же агент, что и для бота |
| **telegram-user** | Отдельно: `http://127.0.0.1:4050/` |

Учётные записи (если включён вход): `local-saas/data/users.json`.
