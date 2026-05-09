#!/usr/bin/env python3
"""
HTTP-вход в Telegram (телефон + код + 2FA) для тестового MVP.
Запуск: из каталога connector с активированным venv:
  pip install -r requirements.txt
  python auth_server.py

Переменные: как в login.py (connector/.env) + AUTH_SERVER_PORT=4052
Требует заголовок X-Connector-Secret (как internal API).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from typing import Any

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from pyrogram import Client
from pyrogram.errors import SessionPasswordNeeded

load_dotenv()

api_id = int(os.environ.get("TELEGRAM_API_ID", "0"))
api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
base = os.environ.get("API_BASE_URL", "http://127.0.0.1:4050").rstrip("/")
expected_secret = os.environ.get("CONNECTOR_SECRET", "").strip()
wd = os.path.join(os.path.dirname(__file__), "sessions")
os.makedirs(wd, exist_ok=True)

# session_id -> { "client": Client, "phone": str, "phone_code_hash": str, "app_user_id": str }
_auth_sessions: dict[str, dict[str, Any]] = {}
_lock = asyncio.Lock()


def _check_secret(x: str | None) -> None:
    if not expected_secret or x != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid X-Connector-Secret")


class SendCodeBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    app_user_id: str = Field(..., alias="appUserId")
    phone: str


class VerifyCodeBody(BaseModel):
    session_id: str
    code: str


class VerifyPasswordBody(BaseModel):
    session_id: str
    password: str


app = FastAPI(title="Telegram User auth (MVP)", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4050", "http://localhost:4050"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/auth/send-code")
async def send_code(
    body: SendCodeBody,
    x_connector_secret: str | None = Header(None, alias="X-Connector-Secret"),
) -> dict[str, Any]:
    _check_secret(x_connector_secret)
    if not api_id or not api_hash:
        raise HTTPException(status_code=500, detail="TELEGRAM_API_ID / TELEGRAM_API_HASH not set")

    headers = {"X-Connector-Secret": expected_secret}
    async with httpx.AsyncClient(timeout=30.0) as h:
        r = await h.post(
            f"{base}/internal/ensure-account",
            json={"appUserId": body.app_user_id},
            headers=headers,
        )
        r.raise_for_status()

    phone = body.phone.strip().replace(" ", "")
    if not phone.startswith("+"):
        phone = "+" + phone.lstrip("+")

    session_id = str(uuid.uuid4())
    name = f"auth_{session_id[:12]}"
    client = Client(name, api_id=api_id, api_hash=api_hash, workdir=wd)

    await client.connect()
    sent = await client.send_code(phone)

    async with _lock:
        _auth_sessions[session_id] = {
            "client": client,
            "phone": phone,
            "phone_code_hash": sent.phone_code_hash,
            "app_user_id": body.app_user_id,
        }

    return {"session_id": session_id, "phone_code_hash": sent.phone_code_hash}


async def _finalize_and_upload(client: Client, app_user_id: str) -> dict[str, Any]:
    session_string = await client.export_session_string()
    headers = {"X-Connector-Secret": expected_secret}
    async with httpx.AsyncClient(timeout=30.0) as h:
        r = await h.post(
            f"{base}/internal/session",
            json={"appUserId": app_user_id, "sessionString": session_string},
            headers=headers,
        )
        r.raise_for_status()
        return r.json()


@app.post("/auth/verify-code")
async def verify_code(
    body: VerifyCodeBody,
    x_connector_secret: str | None = Header(None, alias="X-Connector-Secret"),
) -> dict[str, Any]:
    _check_secret(x_connector_secret)
    async with _lock:
        entry = _auth_sessions.get(body.session_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Unknown session_id")

    client: Client = entry["client"]
    phone = entry["phone"]
    hsh = entry["phone_code_hash"]
    app_user_id = entry["app_user_id"]

    try:
        await client.sign_in(phone, hsh, body.code.strip())
    except SessionPasswordNeeded:
        return {"need_2fa": True, "session_id": body.session_id}
    except Exception as e:
        await _cleanup_session(body.session_id)
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        out = await _finalize_and_upload(client, app_user_id)
    finally:
        await _cleanup_session(body.session_id)

    return {"ok": True, **out}


@app.post("/auth/verify-password")
async def verify_password(
    body: VerifyPasswordBody,
    x_connector_secret: str | None = Header(None, alias="X-Connector-Secret"),
) -> dict[str, Any]:
    _check_secret(x_connector_secret)
    async with _lock:
        entry = _auth_sessions.get(body.session_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Unknown session_id")

    client: Client = entry["client"]
    app_user_id = entry["app_user_id"]

    try:
        await client.check_password(body.password)
    except Exception as e:
        await _cleanup_session(body.session_id)
        raise HTTPException(status_code=400, detail=str(e)) from e

    try:
        out = await _finalize_and_upload(client, app_user_id)
    finally:
        await _cleanup_session(body.session_id)

    return {"ok": True, **out}


async def _cleanup_session(session_id: str) -> None:
    async with _lock:
        entry = _auth_sessions.pop(session_id, None)
    if not entry:
        return
    client: Client = entry["client"]
    try:
        await client.stop()
    except Exception:
        pass


def main() -> None:
    load_dotenv()
    port = int(os.environ.get("AUTH_SERVER_PORT", "4052"))
    if not expected_secret:
        print("Задайте CONNECTOR_SECRET в connector/.env", file=sys.stderr)
        sys.exit(1)
    print(f"Auth server http://127.0.0.1:{port}  (docs /docs)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
