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
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
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


def _login_trace_enabled() -> bool:
    return os.environ.get("LOGIN_WIZARD_TRACE", "").strip().lower() in ("1", "true", "yes", "on")


def _login_trace(line: str) -> None:
    if not _login_trace_enabled():
        return
    print(f"[login_wizard_trace] {line}", file=sys.stderr, flush=True)


def _mask_phone_for_trace(phone: str) -> str:
    """Только для диагностики: не логируем полный номер."""
    p = phone.strip()
    if len(p) <= 5:
        return "***"
    return f"{p[:3]}…{p[-2:]}"


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


def _strip_phone_like_digit_runs(text: str) -> str:
    """Убрать длинные цепочки цифр из текста уведомления (часто там номер телефона)."""
    text = re.sub(r"\d{10,}", " ", text)
    text = re.sub(r"\+?\d(?:[\d\s\-–—().]|\xa0){8,}\d", " ", text)
    return text


def _strip_format_chars(s: str) -> str:
    """Скрытые символы направления (BiDi и т.п.) ломают извлечение кода из вставки из Telegram."""
    return "".join(ch for ch in s if unicodedata.category(ch) != "Cf")


def _login_code_digits(code: str) -> str:
    """Извлечь 5–6 цифр кода; не склеивать с номером из того же сообщения."""
    code = _strip_format_chars(code.strip())
    code = _strip_phone_like_digit_runs(code)
    out: list[str] = []
    for ch in code:
        try:
            d = unicodedata.digit(ch)
        except (TypeError, ValueError):
            continue
        if 0 <= d <= 9:
            out.append(str(d))
    s = "".join(out)
    if len(s) in (5, 6):
        return s
    blocks = re.findall(r"\d{5,6}", s)
    if len(blocks) == 1:
        return blocks[0]
    if len(blocks) > 1:
        return blocks[0]
    m = re.match(r"^(\d{5,6})", s)
    if m:
        return m.group(1)
    return s


def _coerce_phone_code_hash(raw: object) -> str:
    if isinstance(raw, bytes):
        return raw.decode("ascii")
    return str(raw).strip()


def _normalize_mtproto_phone(phone: str) -> str | dict:
    phone = (
        phone.strip()
        .replace(" ", "")
        .replace("\u00a0", "")
        .replace("\t", "")
        .replace("-", "")
        .replace("(", "")
        .replace(")", "")
    )
    if re.fullmatch(r"8\d{10}", phone):
        phone = "+7" + phone[1:]
    if not phone.startswith("+"):
        return {"ok": False, "error": "phone_must_include_country_code_plus"}
    return phone


@dataclass
class _WizardHold:
    """Один живой Pyrogram Client между send_code и sign_in (режим --ipc)."""

    app: Client | None = None
    session_name: str | None = None
    workdir: Path | None = None
    phone: str | None = None
    phone_code_hash: str | None = None
    awaiting_password: bool = False


async def _ipc_reset_hold(hold: _WizardHold) -> None:
    if hold.app is not None:
        try:
            await hold.app.disconnect()
        except Exception:
            pass
        hold.app = None
    if hold.session_name is not None and hold.workdir is not None:
        _remove_session_files(hold.session_name, hold.workdir)
    hold.session_name = None
    hold.workdir = None
    hold.phone = None
    hold.phone_code_hash = None
    hold.awaiting_password = False


def _ipc_clear_hold_refs(hold: _WizardHold) -> None:
    hold.app = None
    hold.session_name = None
    hold.workdir = None
    hold.phone = None
    hold.phone_code_hash = None
    hold.awaiting_password = False


async def _ipc_try_restore_hold_from_disk(hold: _WizardHold, app_user_id: str) -> bool:
    """Восстановить Pyrogram Client из wizard_state (рестарт процесса / новый TCP после send_code)."""
    if hold.app is not None:
        return True
    st = _load_state(app_user_id)
    if not st:
        return False
    session_name = st.get("session_name")
    wd_s = st.get("workdir")
    phone = st.get("phone")
    if not isinstance(session_name, str) or not isinstance(wd_s, str) or not isinstance(phone, str):
        return False
    phone_code_hash = _coerce_phone_code_hash(st.get("phone_code_hash"))
    if len(phone_code_hash) < 8:
        return False
    workdir = Path(wd_s)
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return False
    await asyncio.sleep(0.25)
    app: Client | None = None
    try:
        app = Client(session_name, api_id=api_id, api_hash=api_hash, workdir=workdir)
        await app.connect()
        await app.storage.save()
    except Exception:
        if app is not None:
            try:
                await app.disconnect()
            except Exception:
                pass
        return False
    hold.app = app
    hold.session_name = session_name
    hold.workdir = workdir
    hold.phone = phone
    hold.phone_code_hash = phone_code_hash
    hold.awaiting_password = bool(st.get("awaiting_password"))
    return True


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

    np = _normalize_mtproto_phone(phone)
    if isinstance(np, dict):
        return np
    phone = np

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
    _login_trace(
        "send_code_invoke Pyrogram Client.send_code "
        f"app_user_id_head={app_user_id[:48]!r} api_id={api_id} "
        f"phone_mask={_mask_phone_for_trace(phone)!r} session={session_name!r}"
    )
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

    pch = _coerce_phone_code_hash(sent.phone_code_hash)
    _save_state(
        app_user_id,
        {
            "session_name": session_name,
            "phone": phone,
            "phone_code_hash": pch,
            "workdir": str(wd),
        },
    )
    return {"ok": True, "phone_code_hash": pch}


async def cmd_sign_in(app_user_id: str, code: str) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    st = _load_state(app_user_id)
    if not st:
        return {"ok": False, "error": "no_pending_login_send_code_first"}

    session_name = st["session_name"]
    phone = st["phone"]
    phone_code_hash = _coerce_phone_code_hash(st.get("phone_code_hash"))
    if len(phone_code_hash) < 8:
        return {"ok": False, "error": "wizard_corrupt_phone_code_hash_retry_send_code"}

    workdir = Path(st["workdir"])

    code_digits = _login_code_digits(code)
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


async def ipc_cmd_send_code(
    hold: _WizardHold,
    app_user_id: str,
    phone: str,
    force_resend: bool = False,
) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    np = _normalize_mtproto_phone(phone)
    if isinstance(np, dict):
        return np

    if (
        not force_resend
        and hold.app is not None
        and hold.phone_code_hash
        and not hold.awaiting_password
        and hold.phone is not None
        and hold.phone == np
    ):
        pch = _coerce_phone_code_hash(hold.phone_code_hash)
        _login_trace(
            "send_code_skip_duplicate "
            f"app_user_id_head={app_user_id[:48]!r} phone_mask={_mask_phone_for_trace(phone)!r} "
            f"hash_len={len(pch)} hash_prefix={pch[:16]!r}"
        )
        return {"ok": True, "already_sent": True, "phone_code_hash": pch}

    await _ipc_reset_hold(hold)

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

    phone = np

    wd = _wizard_workdir()
    import hashlib

    digest = hashlib.sha256(f"{app_user_id}:{phone}:{os.urandom(8).hex()}".encode()).hexdigest()[:18]
    session_name = f"w_{digest}"

    app = Client(session_name, api_id=api_id, api_hash=api_hash, workdir=wd)
    await app.connect()
    _login_trace(
        "send_code_invoke Pyrogram Client.send_code "
        f"app_user_id_head={app_user_id[:48]!r} api_id={api_id} "
        f"phone_mask={_mask_phone_for_trace(phone)!r} session={session_name!r}"
    )
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
    pch = _coerce_phone_code_hash(sent.phone_code_hash)
    hold.app = app
    hold.session_name = session_name
    hold.workdir = wd
    hold.phone = phone
    hold.phone_code_hash = pch
    hold.awaiting_password = False
    _save_state(
        app_user_id,
        {
            "session_name": session_name,
            "phone": phone,
            "phone_code_hash": pch,
            "workdir": str(wd),
            "awaiting_password": False,
        },
    )
    return {"ok": True, "phone_code_hash": pch}


async def ipc_cmd_sign_in(hold: _WizardHold, app_user_id: str, code: str) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    if hold.app is None:
        if not await _ipc_try_restore_hold_from_disk(hold, app_user_id):
            return {"ok": False, "error": "no_pending_login_send_code_first"}
    if hold.phone is None or hold.phone_code_hash is None:
        return {"ok": False, "error": "no_pending_login_send_code_first"}
    if hold.awaiting_password:
        return {"ok": False, "error": "wizard_waiting_password_use_password_command"}

    phone_code_hash = _coerce_phone_code_hash(hold.phone_code_hash)
    if len(phone_code_hash) < 8:
        await _ipc_reset_hold(hold)
        _clear_state(app_user_id)
        return {"ok": False, "error": "wizard_corrupt_phone_code_hash_retry_send_code"}

    code_digits = _login_code_digits(code)
    if len(code_digits) not in (5, 6):
        return {"ok": False, "error": "code_must_be_5_or_6_digits"}

    app = hold.app
    session_name = hold.session_name
    workdir = hold.workdir
    phone = hold.phone

    _login_trace(
        "sign_in_invoke Pyrogram Client.sign_in "
        f"app_user_id_head={app_user_id[:48]!r} phone_mask={_mask_phone_for_trace(phone)!r} "
        f"hash_len={len(phone_code_hash)} hash_prefix={phone_code_hash[:16]!r} "
        f"code_digit_len={len(code_digits)} session={session_name!r}"
    )

    try:
        try:
            signed = await app.sign_in(phone, phone_code_hash, code_digits)
        except SessionPasswordNeeded:
            hold.awaiting_password = True
            await app.storage.save()
            if session_name is not None and workdir is not None and phone is not None:
                _save_state(
                    app_user_id,
                    {
                        "session_name": session_name,
                        "phone": phone,
                        "phone_code_hash": phone_code_hash,
                        "workdir": str(workdir),
                        "awaiting_password": True,
                    },
                )
            return {"ok": True, "need_password": True}
        except (
            PhoneCodeInvalid,
            PhoneCodeExpired,
            PhoneCodeHashEmpty,
            PhoneCodeEmpty,
        ) as e:
            await app.disconnect()
            if session_name is not None and workdir is not None:
                _remove_session_files(session_name, workdir)
            _ipc_clear_hold_refs(hold)
            _clear_state(app_user_id)
            return {"ok": False, "error": str(e), "wizard_cleared": True}

        if signed is False:
            await app.disconnect()
            if session_name is not None and workdir is not None:
                _remove_session_files(session_name, workdir)
            _ipc_clear_hold_refs(hold)
            _clear_state(app_user_id)
            return {
                "ok": False,
                "error": "telegram_requires_signup_complete_once_in_official_telegram_app",
            }
        if isinstance(signed, types.TermsOfService):
            await app.disconnect()
            if session_name is not None and workdir is not None:
                _remove_session_files(session_name, workdir)
            _ipc_clear_hold_refs(hold)
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
            if session_name is not None and workdir is not None:
                _remove_session_files(session_name, workdir)
            _ipc_clear_hold_refs(hold)
            _clear_state(app_user_id)
            return {"ok": False, "error": "signed_in_as_bot_use_personal_phone"}
        session_string = await app.export_session_string()
        tid = me.id
        await app.disconnect()
        if session_name is not None and workdir is not None:
            _remove_session_files(session_name, workdir)
        _ipc_clear_hold_refs(hold)
        _clear_state(app_user_id)
        return {"ok": True, "session_string": session_string, "telegram_user_id": tid}
    except Exception as e:  # noqa: BLE001
        try:
            await app.disconnect()
        except Exception:
            pass
        return {"ok": False, "error": str(e)}


async def ipc_cmd_password(hold: _WizardHold, app_user_id: str, password: str) -> dict:
    api_id, api_hash = _api_creds()
    if not api_id or not api_hash:
        return {"ok": False, "error": "missing_TELEGRAM_API_ID_or_TELEGRAM_API_HASH"}

    if hold.app is None or not hold.awaiting_password:
        if not await _ipc_try_restore_hold_from_disk(hold, app_user_id):
            return {"ok": False, "error": "no_pending_password_step"}
    if hold.app is None or not hold.awaiting_password:
        return {"ok": False, "error": "no_pending_password_step"}

    app = hold.app
    session_name = hold.session_name
    workdir = hold.workdir
    try:
        await app.check_password(password.strip())
        me = await app.get_me()
        session_string = await app.export_session_string()
        tid = me.id
        await app.disconnect()
        if session_name is not None and workdir is not None:
            _remove_session_files(session_name, workdir)
        _ipc_clear_hold_refs(hold)
        _clear_state(app_user_id)
        return {"ok": True, "session_string": session_string, "telegram_user_id": tid}
    except Exception as e:  # noqa: BLE001
        try:
            await app.disconnect()
        except Exception:
            pass
        if session_name is not None and workdir is not None:
            _remove_session_files(session_name, workdir)
        _ipc_clear_hold_refs(hold)
        _clear_state(app_user_id)
        return {"ok": False, "error": str(e)}


async def ipc_dispatch(
    expected_uid: str,
    req: dict,
    hold: _WizardHold,
    schedule_server_shutdown: Callable[[], Awaitable[None]] | None = None,
) -> dict:
    rid = str(req.get("app_user_id", "")).strip()
    if rid != expected_uid:
        return {"ok": False, "error": "app_user_id_mismatch"}

    cmd = req.get("cmd")
    if cmd == "ping":
        return {"ok": True, "pong": True}
    if cmd == "shutdown":
        await _ipc_reset_hold(hold)
        if schedule_server_shutdown is not None:
            asyncio.create_task(schedule_server_shutdown())
        return {"ok": True, "shutdown": True}
    if cmd == "send_code":
        phone = str(req.get("phone", "")).strip()
        if not phone:
            return {"ok": False, "error": "phone_required"}
        force_resend = bool(req.get("force_resend"))
        return await ipc_cmd_send_code(hold, rid, phone, force_resend)
    if cmd == "sign_in":
        code = str(req.get("code", "")).strip()
        if not code:
            return {"ok": False, "error": "code_required"}
        return await ipc_cmd_sign_in(hold, rid, code)
    if cmd == "password":
        pwd = str(req.get("password", ""))
        if not pwd:
            return {"ok": False, "error": "password_required"}
        return await ipc_cmd_password(hold, rid, pwd)
    return {"ok": False, "error": f"unknown_cmd:{cmd}"}


async def tcp_main(expected_uid: str) -> None:
    hold = _WizardHold()
    ipc_dir = ROOT / "sessions" / "wizard_ipc" / _safe_app_id(expected_uid)
    ipc_dir.mkdir(parents=True, exist_ok=True)
    req_lock = asyncio.Lock()
    srv_holder: list[asyncio.AbstractServer | None] = [None]

    async def shutdown_srv() -> None:
        s = srv_holder[0]
        if s is not None:
            s.close()
            await s.wait_closed()

    async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                line_b = await reader.readline()
                if not line_b:
                    break
                line_s = line_b.decode("utf-8").strip()
                if not line_s:
                    continue
                try:
                    req = json.loads(line_s)
                except json.JSONDecodeError as e:
                    payload = {"ok": False, "error": f"invalid_json:{e}"}
                    writer.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
                    await writer.drain()
                    continue
                async with req_lock:
                    try:
                        out = await ipc_dispatch(expected_uid, req, hold, shutdown_srv)
                    except Exception as e:  # noqa: BLE001
                        out = {"ok": False, "error": str(e)}
                writer.write((json.dumps(out, ensure_ascii=False) + "\n").encode("utf-8"))
                await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    srv = await asyncio.start_server(handle_client, "127.0.0.1", 0, reuse_address=True)
    srv_holder[0] = srv
    socks = srv.sockets or []
    bound_port = socks[0].getsockname()[1]
    (ipc_dir / "port.txt").write_text(str(bound_port), encoding="utf-8")
    (ipc_dir / "pid.txt").write_text(str(os.getpid()), encoding="utf-8")

    try:
        async with srv:
            await srv.serve_forever()
    finally:
        await _ipc_reset_hold(hold)
        for name in ("port.txt", "pid.txt"):
            try:
                (ipc_dir / name).unlink()
            except OSError:
                pass


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
    if len(sys.argv) >= 3 and sys.argv[1] == "--ipc-tcp":
        uid = sys.argv[2].strip()
        if not uid:
            print(json.dumps({"ok": False, "error": "ipc_tcp_missing_app_user_arg"}), flush=True)
            return
        try:
            asyncio.run(tcp_main(uid))
        except KeyboardInterrupt:
            pass
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(e)}), flush=True)
        return

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
