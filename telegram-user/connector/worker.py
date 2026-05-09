#!/usr/bin/env python3
"""
Синхронизация диалогов/сообщений в API и обработка исходящей очереди (TgPendingSend).
Требует: выполненный login.py, работающий npm run dev (telegram-user API).
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Any

import httpx
from dotenv import load_dotenv
from pyrogram import Client, filters, idle
from pyrogram.enums import ChatType
from pyrogram.types import Message as TgMessage


def is_product_bot_chat(chat: Any) -> bool:
    """
    Prevent bot<->agent loops:
    - The product bot chat (Bot API) should not be ingested into MTProto automation pipeline.
    - Otherwise, with replyMode=auto, the agent can start replying to the product bot itself.
    """
    uname = (getattr(chat, "username", None) or "").strip().lstrip("@")
    cfg = (os.environ.get("PRODUCT_BOT_USERNAME", "") or "").strip().lstrip("@")
    if cfg and uname and uname.lower() == cfg.lower():
        return True
    # Fallback: if chat exposes is_bot, exclude all bots to avoid similar loops.
    if bool(getattr(chat, "is_bot", False)):
        return True
    return False


def map_chat_type(chat: Any) -> str:
    t = chat.type
    if t == ChatType.PRIVATE:
        return "user"
    if t == ChatType.GROUP:
        return "group"
    if t == ChatType.SUPERGROUP:
        return "supergroup"
    if t == ChatType.CHANNEL:
        return "channel"
    return "user"


def chat_title(chat: Any) -> str | None:
    if getattr(chat, "title", None):
        return chat.title
    fn = getattr(chat, "first_name", None) or ""
    ln = getattr(chat, "last_name", None) or ""
    s = f"{fn} {ln}".strip()
    return s or None


async def ingest_one_message(
    http: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    account_id: str,
    dialog_id: str,
    peer_key: str,
    msg: TgMessage,
) -> None:
    body = {
        "accountId": account_id,
        "dialogId": dialog_id,
        "peerKey": peer_key,
        "tgMessageId": msg.id,
        "date": msg.date.isoformat(),
        "text": msg.text or msg.caption,
        "out": bool(msg.outgoing),
    }
    r = await http.post(f"{base}/internal/ingest/message", json=body, headers=headers)
    r.raise_for_status()


async def sync_dialogs_and_messages(
    client: Client,
    http: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    account_id: str,
) -> None:
    n = 0
    async for dialog in client.get_dialogs(limit=40):
        chat = dialog.chat
        if is_product_bot_chat(chat):
            continue
        peer_key = str(chat.id)
        payload = {
            "accountId": account_id,
            "peerKey": peer_key,
            "title": chat_title(chat),
            "dialogType": map_chat_type(chat),
            "lastMsgId": None,
            "unreadLocal": int(getattr(dialog, "unread_messages_count", 0) or 0),
        }
        r = await http.post(f"{base}/internal/ingest/dialog", json=payload, headers=headers)
        r.raise_for_status()
        dialog_id = r.json()["dialogId"]

        async for msg in client.get_chat_history(chat.id, limit=40):
            await ingest_one_message(http, base, headers, account_id, dialog_id, peer_key, msg)

        n += 1
        await asyncio.sleep(0.15)

    print(f"sync: диалогов обработано: {n}", flush=True)


async def outbox_loop(
    client: Client,
    http: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    account_id: str,
) -> None:
    while True:
        try:
            r = await http.get(f"{base}/internal/pending-sends/{account_id}", headers=headers)
            r.raise_for_status()
            for item in r.json().get("items", []):
                pid = item["id"]
                peer_key = item["peerKey"]
                text = item["text"]
                try:
                    if str(peer_key).strip().lower() in ("me", "self"):
                        await client.send_message("me", text)
                    else:
                        await client.send_message(int(peer_key), text)
                    await http.patch(
                        f"{base}/internal/pending-sends/{pid}",
                        json={"status": "sent"},
                        headers=headers,
                    )
                except Exception as e:
                    await http.patch(
                        f"{base}/internal/pending-sends/{pid}",
                        json={"status": "failed", "error": str(e)[:500]},
                        headers=headers,
                    )
        except Exception as e:
            print("outbox error:", e, flush=True)
        await asyncio.sleep(2.0)


async def worker_ping_loop(
    http: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    account_id: str,
    app_user_id: str,
) -> None:
    while True:
        try:
            r = await http.post(
                f"{base}/internal/worker-ping",
                json={"accountId": account_id, "appUserId": app_user_id},
                headers=headers,
            )
            r.raise_for_status()
        except Exception as e:
            print("worker ping:", e, flush=True)
        await asyncio.sleep(120.0)


def fetch_account_and_session_sync(
    base: str,
    headers: dict[str, str],
    app_user_id: str,
) -> tuple[str, str]:
    """Запросы к API при старте API/tsx watch могут кратко рвать соединение — повторяем."""
    last_exc: BaseException | None = None
    for attempt in range(1, 8):
        try:
            with httpx.Client(timeout=60.0) as h:
                r = h.get(f"{base}/internal/account-by-user", params={"appUserId": app_user_id}, headers=headers)
                if r.status_code == 404:
                    print("Сначала выполните login.py", file=sys.stderr)
                    sys.exit(1)
                r.raise_for_status()
                account_id = r.json()["accountId"]

                r = h.get(f"{base}/internal/session/{app_user_id}", headers=headers)
                if r.status_code == 404:
                    print(
                        "Нет сохранённой сессии в БД. Выполните: python login.py (номер телефона и код из Telegram), затем снова worker.py.",
                        file=sys.stderr,
                    )
                    sys.exit(1)
                r.raise_for_status()
                return account_id, r.json()["sessionString"]
        except (
            httpx.ReadError,
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.RemoteProtocolError,
            httpx.WriteError,
        ) as e:
            last_exc = e
            print(
                f"worker: API {base} временно недоступен (попытка {attempt}/7): {e}",
                flush=True,
            )
            time.sleep(min(3 * attempt, 20))
    if last_exc:
        raise last_exc
    raise RuntimeError("API unreachable")


async def main_async() -> None:
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
    api_id = int(os.environ.get("TELEGRAM_API_ID", "0"))
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    app_user_id = os.environ.get("APP_USER_ID", "").strip()
    base = os.environ.get("API_BASE_URL", "http://127.0.0.1:4050").rstrip("/")
    secret = os.environ.get("CONNECTOR_SECRET", "").strip()

    if not api_id or not api_hash or not app_user_id or not secret:
        print("Нужны TELEGRAM_API_ID, TELEGRAM_API_HASH, APP_USER_ID, CONNECTOR_SECRET", file=sys.stderr)
        sys.exit(1)

    headers = {"X-Connector-Secret": secret}
    timeout = httpx.Timeout(60.0)

    account_id, session_string = fetch_account_and_session_sync(base, headers, app_user_id)

    name = os.environ.get("PYROGRAM_SESSION_NAME", "tg_user_mvp_worker")
    wd = os.path.join(os.path.dirname(__file__), "sessions")
    os.makedirs(wd, exist_ok=True)
    app = Client(
        name,
        api_id=api_id,
        api_hash=api_hash,
        session_string=session_string,
        workdir=wd,
    )

    account_id_ref: dict[str, str] = {"id": account_id}

    @app.on_message(filters.all)
    async def on_msg(_client: Client, message: TgMessage) -> None:
        async with httpx.AsyncClient(timeout=timeout) as http2:
            chat = message.chat
            if is_product_bot_chat(chat):
                return
            peer_key = str(chat.id)
            payload = {
                "accountId": account_id_ref["id"],
                "peerKey": peer_key,
                "title": chat_title(chat),
                "dialogType": map_chat_type(chat),
                "lastMsgId": message.id,
                "unreadLocal": 0,
            }
            try:
                dr = await http2.post(f"{base}/internal/ingest/dialog", json=payload, headers=headers)
                dr.raise_for_status()
                dialog_id = dr.json()["dialogId"]
                await ingest_one_message(
                    http2, base, headers, account_id_ref["id"], dialog_id, peer_key, message
                )
            except Exception as e:
                print("ingest error:", e, flush=True)

    await app.start()
    me = await app.get_me()
    if getattr(me, "is_bot", False):
        print(
            "Сессия в БД — это бот. Воркеру нужен личный аккаунт (не токен @BotFather).\n"
            "Сброс: POST http://127.0.0.1:4050/internal/reset-session с JSON {\"appUserId\":\"...\"} "
            "и заголовком X-Connector-Secret; затем login.py с номером телефона; удалите connector/sessions/*",
            file=sys.stderr,
        )
        await app.stop()
        sys.exit(1)

    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            print("worker: синхронизация…", flush=True)
            await sync_dialogs_and_messages(app, http, base, headers, account_id)
            asyncio.create_task(outbox_loop(app, http, base, headers, account_id))
            asyncio.create_task(worker_ping_loop(http, base, headers, account_id, app_user_id))
            print("worker: ожидание событий (Ctrl+C)…", flush=True)
            await idle()
    finally:
        await app.stop()


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
