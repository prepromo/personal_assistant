#!/usr/bin/env python3
"""
Одноразовые шаги входа MTProto для кабинета/бота (stdin JSON → stdout JSON).
Нужны TELEGRAM_API_ID / TELEGRAM_API_HASH в connector/.env (или в окружении процесса).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client, types
from pyrogram.errors import (
    FloodWait,
    PhoneCodeEmpty,
    PhoneCodeExpired,
    PhoneCodeHashEmpty,
    PhoneCodeInvalid,
    SessionPasswordNeeded,
)

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)


def _safe_app_id(app_user_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", app_user_id)[:120]


def _state_path(app_user_id: str) -> Path:
    return ROOT / "sessions" / "wizard_state" / f"{_safe_app_id(app_user_id)}.json"


def _load_state(app_user_id: str) -> dict | None:
    p = _state_path(app_user_id)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _save_state(app_user_id: str, data: dict) -> None:
    p = _state_path(app_user_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data), encoding="utf-8")


def _clear_state(app_user_id: str) -> None:
    p = _state_path(app_user_id)
    if p.exists():
        p.unlink()


def _wizard_workdir() -> Path:
    p = ROOT / "sessions" / "wizard"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _remove_session_files(session_name: str, workdir: Path) -> None:
    for path in workdir.glob(f"{session_name}.session*"):
        try:
            path.unlink()
        except OSError:
            pass


def _api_creds() -> tuple[int, str] | tuple[None, None]:
    api_id = int(os.environ.get("TELEGRAM_API_ID", "0") or 0)
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    if not api_id or not api_hash:
        return None, None
    return api_id, api_hash


async def cmd_send_code(app_user_id: str, phone: str) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    phone = (
        phone.strip()
        .replace(" ", "")
        .replace("\u00a0", "")
        .replace("\t", "")
        .replace("-", "")
        .replace("(", "")
        .replace(")", "")
    )
    # Частый ввод без +: российский 8XXXXXXXXXX
    if re.fullmatch(r"8\d{10}", phone):
        phone = "+7" + phone[1:]
    if not phone.startswith("+"):
        return {"ok": False, "error": "phone_must_include_country_code_plus"}

    prev = _load_state(app_user_id)
    if prev:
        try:
            sn = prev.get("session_name")
            wd_s = prev.get("workdir")
            if isinstance(sn, str) and isinstance(wd_s, str):
                _remove_session_files(sn, Path(wd_s))
        except Exception:
            pass
        _clear_state(app_user_id)

    wd = _wizard_workdir()
    import hashlib

    digest = hashlib.sha256(f"{app_user_id}:{phone}:{os.urandom(8).hex()}".encode()).hexdigest()[:18]
    session_name = f"w_{digest}"

    app = Client(session_name, api_id=api_id, api_hash=api_hash, workdir=wd)
    await app.connect()
    try:
        sent = await app.send_code(phone)
    except FloodWait as e:
        await app.disconnect()
        return {"ok": False, "error": "flood_wait", "seconds": e.value}
    except Exception as e:  # noqa: BLE001
        await app.disconnect()
        _remove_session_files(session_name, wd)
        return {"ok": False, "error": str(e)}
    await app.storage.save()
    await app.disconnect()

    _save_state(
        app_user_id,
        {
            "session_name": session_name,
            "phone": phone,
            "phone_code_hash": sent.phone_code_hash,
            "workdir": str(wd),
        },
    )
    return {"ok": True, "phone_code_hash": sent.phone_code_hash}


async def cmd_sign_in(app_user_id: str, code: str) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    st = _load_state(app_user_id)
    if not st:
        return {"ok": False, "error": "no_pending_login_send_code_first"}

    session_name = st["session_name"]
    phone = st["phone"]
    phone_code_hash = st.get("phone_code_hash")
    if not isinstance(phone_code_hash, str) or len(phone_code_hash) < 8:
        return {"ok": False, "error": "wizard_corrupt_phone_code_hash_retry_send_code"}

    workdir = Path(st["workdir"])

    code_digits = "".join(ch for ch in code if ch in "0123456789")
    if len(code_digits) not in (5, 6):
        return {"ok": False, "error": "code_must_be_5_or_6_digits"}

    # Windows: дождаться полного закрытия SQLite прошлым процессом после send_code
    await asyncio.sleep(0.25)

    app = Client(session_name, api_id=api_id, api_hash=api_hash, workdir=workdir)
    await app.connect()
    await app.storage.save()
    try:
        try:
            signed = await app.sign_in(phone, phone_code_hash, code_digits)
        except SessionPasswordNeeded:
            st["awaiting_password"] = True
            _save_state(app_user_id, st)
            await app.disconnect()
            return {"ok": True, "need_password": True}
        except (
            PhoneCodeInvalid,
            PhoneCodeExpired,
            PhoneCodeHashEmpty,
            PhoneCodeEmpty,
        ) as e:
            await app.disconnect()
            _remove_session_files(session_name, workdir)
            _clear_state(app_user_id)
            return {"ok": False, "error": str(e), "wizard_cleared": True}
        if signed is False:
            await app.disconnect()
            _remove_session_files(session_name, workdir)
            _clear_state(app_user_id)
            return {
                "ok": False,
                "error": "telegram_requires_signup_complete_once_in_official_telegram_app",
            }
        if isinstance(signed, types.TermsOfService):
            await app.disconnect()
            _remove_session_files(session_name, workdir)
            _clear_state(app_user_id)
            return {
                "ok": False,
                "error": "telegram_terms_of_service_accept_in_official_client_first",
            }
        if not isinstance(signed, types.User):
            await app.disconnect()
            return {"ok": False, "error": f"unexpected_sign_in:{type(signed)!r}"}
        me = signed
        if getattr(me, "is_bot", False):
            await app.disconnect()
            _remove_session_files(session_name, workdir)
            _clear_state(app_user_id)
            return {"ok": False, "error": "signed_in_as_bot_use_personal_phone"}
        session_string = await app.export_session_string()
        tid = me.id
        await app.disconnect()
        _remove_session_files(session_name, workdir)
        _clear_state(app_user_id)
        return {"ok": True, "session_string": session_string, "telegram_user_id": tid}
    except Exception as e:  # noqa: BLE001
        try:
            await app.disconnect()
        except Exception:
            pass
        return {"ok": False, "error": str(e)}


async def cmd_password(app_user_id: str, password: str) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    st = _load_state(app_user_id)
    if not st or not st.get("awaiting_password"):
        return {"ok": False, "error": "no_pending_password_step"}

    session_name = st["session_name"]
    workdir = Path(st["workdir"])

    app = Client(session_name, api_id=api_id, api_hash=api_hash, workdir=workdir)
    await app.connect()
    try:
        await app.check_password(password.strip())
        me = await app.get_me()
        session_string = await app.export_session_string()
        tid = me.id
        await app.disconnect()
        _remove_session_files(session_name, workdir)
        _clear_state(app_user_id)
        return {"ok": True, "session_string": session_string, "telegram_user_id": tid}
    except Exception as e:  # noqa: BLE001
        try:
            await app.disconnect()
        except Exception:
            pass
        return {"ok": False, "error": str(e)}


async def dispatch(req: dict) -> dict:
    cmd = req.get("cmd")
    app_user_id = str(req.get("app_user_id", "")).strip()
    if not app_user_id:
        return {"ok": False, "error": "app_user_id_required"}

    if cmd == "send_code":
        phone = str(req.get("phone", "")).strip()
        if not phone:
            return {"ok": False, "error": "phone_required"}
        return await cmd_send_code(app_user_id, phone)
    if cmd == "sign_in":
        code = str(req.get("code", "")).strip()
        if not code:
            return {"ok": False, "error": "code_required"}
        return await cmd_sign_in(app_user_id, code)
    if cmd == "password":
        password = str(req.get("password", ""))
        if not password:
            return {"ok": False, "error": "password_required"}
        return await cmd_password(app_user_id, password)
    return {"ok": False, "error": f"unknown_cmd:{cmd}"}


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"ok": False, "error": "empty_stdin"}), flush=True)
        return
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid_json:{e}"}), flush=True)
        return
    try:
        out = asyncio.run(dispatch(req))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
        return
    print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
