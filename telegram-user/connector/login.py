#!/usr/bin/env python3
"""
Первичный вход в Telegram (интерактивно: телефон, код).
Нужны TELEGRAM_API_ID / TELEGRAM_API_HASH с https://my.telegram.org
Перед запуском: npm run dev в telegram-user/
Если в connector/sessions/ лежит устаревший .session (AUTH_KEY_UNREGISTERED), файл удаляется и вход повторяется.

Полный сброс (сессия в БД + привязка бота + локальные .session), чтобы снова запросить телефон:
  python login.py --fresh
"""
import argparse
import asyncio
import glob
import os
import sys

import httpx
from dotenv import load_dotenv
from pyrogram import Client
from pyrogram.errors import AuthKeyUnregistered, SessionRevoked


def remove_local_session_files(name: str, wd: str) -> None:
    for path in glob.glob(os.path.join(wd, f"{name}.session*")):
        try:
            os.remove(path)
        except OSError:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Вход Pyrogram + сохранение сессии в API")
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Сбросить сессию в БД, удалить привязки TgBotUserBinding для APP_USER_ID и локальные connector/sessions/*.session — затем новый вход с телефона",
    )
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
    api_id = int(os.environ.get("TELEGRAM_API_ID", "0"))
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    app_user_id = os.environ.get("APP_USER_ID", "").strip()
    base = os.environ.get("API_BASE_URL", "http://127.0.0.1:4050").rstrip("/")
    secret = os.environ.get("CONNECTOR_SECRET", "").strip()
    name = os.environ.get("PYROGRAM_SESSION_NAME", "tg_user_mvp")
    wd = os.path.join(os.path.dirname(__file__), "sessions")

    if not api_id or not api_hash:
        print("Задайте TELEGRAM_API_ID и TELEGRAM_API_HASH в connector/.env", file=sys.stderr)
        sys.exit(1)
    if not app_user_id:
        print("Задайте APP_USER_ID (uuid пользователя продукта)", file=sys.stderr)
        sys.exit(1)
    if not secret:
        print("Задайте CONNECTOR_SECRET (тот же что в telegram-user/.env)", file=sys.stderr)
        sys.exit(1)

    headers = {"X-Connector-Secret": secret}

    with httpx.Client(timeout=30.0) as h:
        if args.fresh:
            rs = h.post(
                f"{base}/internal/reset-session",
                json={"appUserId": app_user_id, "clearBotBindings": True},
                headers=headers,
            )
            if rs.status_code == 404:
                print("reset-session: аккаунт не найден — будет создан через ensure-account", flush=True)
            else:
                rs.raise_for_status()
                print("reset-session (--fresh):", rs.json(), flush=True)
            remove_local_session_files(name, wd)
            print(
                "Удалены локальные файлы сессии в connector/sessions/. Дальше введите телефон и код.\n",
                flush=True,
            )

        r = h.post(f"{base}/internal/ensure-account", json={"appUserId": app_user_id}, headers=headers)
        r.raise_for_status()
        print("ensure-account:", r.json())

    os.makedirs(wd, exist_ok=True)

    async def run_login() -> None:
        # Старый tg_user_mvp.session даёт AUTH_KEY_UNREGISTERED до запроса телефона — удаляем и повторяем вход.
        for attempt in (1, 2):
            try:
                telegram_user_id: int | None = None
                async with Client(name, api_id=api_id, api_hash=api_hash, workdir=wd) as app:
                    me = await app.get_me()
                    if getattr(me, "is_bot", False):
                        print(
                            "Ошибка: введён токен бота. Этот проект — для личного аккаунта (MTProto user).\n"
                            "Введите номер телефона в формате +79991234567 (не токен из @BotFather).\n"
                            "Сбросьте сессию в БД: POST /internal/reset-session с appUserId, удалите файлы в connector/sessions/",
                            file=sys.stderr,
                        )
                        remove_local_session_files(name, wd)
                        sys.exit(1)
                    telegram_user_id = me.id
                    session_string = await app.export_session_string()
                with httpx.Client(timeout=30.0) as h:
                    r = h.post(
                        f"{base}/internal/session",
                        json={"appUserId": app_user_id, "sessionString": session_string},
                        headers=headers,
                    )
                    r.raise_for_status()
                    print("session сохранён в БД:", r.json())
                    if telegram_user_id is not None:
                        lr = h.post(
                            f"{base}/internal/link-telegram-user-to-account",
                            json={
                                "appUserId": app_user_id,
                                "telegramUserId": str(telegram_user_id),
                            },
                            headers=headers,
                        )
                        lr.raise_for_status()
                        print("привязка продуктового бота:", lr.json())
                return
            except (AuthKeyUnregistered, SessionRevoked):
                remove_local_session_files(name, wd)
                if attempt == 1:
                    print(
                        "Локальный файл сессии в connector/sessions/ устарел или отозван Telegram — удалён.\n"
                        "Повторяется вход: введите номер телефона и код из Telegram.",
                        flush=True,
                    )
                    continue
                raise

    asyncio.run(run_login())
    print("Готово. Если запускали только login.py — дальше: python worker.py")
    print("Если использовали run-telegram.ps1 — воркер уже стартует сам.")


if __name__ == "__main__":
    main()
