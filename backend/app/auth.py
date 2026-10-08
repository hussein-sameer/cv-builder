"""Accounts and sessions.

* Passwords: scrypt (stdlib), per-user random salt, constant-time comparison.
* Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie; only its
  SHA-256 is stored server-side, so a database leak doesn't leak live sessions.
* Throttling: failed logins per email and per IP, sign-ups per IP (in-memory,
  fine for a single instance).
* AUTH_ENABLED=false turns all of this off and every request runs as one local user.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import config
from .db import get_db

COOKIE = "cvb_session"
router = APIRouter(prefix="/api/auth", tags=["auth"])


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str
    is_admin: bool

    def public(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name, "isAdmin": self.is_admin}


LOCAL_USER = User(id="local", email="", name="Local user", is_admin=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds")


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"scrypt${_N}${_R}${_P}${b64(salt)}${b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, dk = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(dk)
        got = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return hmac.compare_digest(got, expected)
    except (ValueError, TypeError):
        return False


# Used when the email doesn't exist so response time doesn't reveal which emails are registered.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# --------------------------------------------------------------------------- #
# Throttling
# --------------------------------------------------------------------------- #
class _Window:
    def __init__(self, limit: int, seconds: int):
        self.limit, self.seconds = limit, seconds
        self.hits: dict[str, deque] = defaultdict(deque)

    def blocked(self, key: str) -> bool:
        q = self.hits[key]
        cutoff = time.monotonic() - self.seconds
        while q and q[0] < cutoff:
            q.popleft()
        return len(q) >= self.limit

    def hit(self, key: str) -> None:
        self.hits[key].append(time.monotonic())

    def clear(self, key: str) -> None:
        self.hits.pop(key, None)


_fail_email = _Window(8, 15 * 60)
_fail_ip = _Window(40, 15 * 60)
_signup_ip = _Window(5, 60 * 60)


def reset_throttles() -> None:
    for w in (_fail_email, _fail_ip, _signup_ip):
        w.hits.clear()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _cookie_secure(request: Request) -> bool:
    mode = config.settings.cookie_secure
    if mode in {"true", "1", "yes"}:
        return True
    if mode in {"false", "0", "no"}:
        return False
    return request.url.scheme == "https"


def _set_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=config.settings.session_days * 86400,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        path="/",
    )


def start_session(user_id: str, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = _now()
    with get_db().tx() as c:
        c.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (_token_hash(token), user_id, _iso(now), _iso(now + timedelta(days=config.settings.session_days))),
        )
        c.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (_iso(now), user_id))
        # opportunistic cleanup of expired sessions
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(now),))
    _set_cookie(response, request, token)


def _user_from_row(row: dict) -> User:
    email = row["email"]
    return User(id=row["id"], email=email, name=row["name"], is_admin=email in config.settings.admin_emails)


def current_user(request: Request) -> User:
    """FastAPI dependency: the logged-in user, or 401."""
    if not config.settings.auth_enabled:
        return LOCAL_USER
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Please log in.")
    with get_db().tx() as c:
        row = c.one(
            "SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ?",
            (_token_hash(token),),
        )
        if row and row["expires_at"] < _iso(_now()):
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
            row = None
    if not row:
        raise HTTPException(401, "Your session has expired. Please log in again.")
    request.state.session_expires = row["expires_at"]
    return _user_from_row(row)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class SignupBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    name: str = Field(default="", max_length=100)


class LoginBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class PasswordBody(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(max_length=200)


class DeleteBody(BaseModel):
    password: str = Field(default="", max_length=200)


def _check_new_password(pw: str) -> None:
    if len(pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if pw.strip() != pw or not pw.strip():
        raise HTTPException(400, "Password can't start or end with spaces.")


@router.get("/config")
def auth_config():
    s = config.settings
    return {"authEnabled": s.auth_enabled, "signupEnabled": s.auth_enabled and s.signup_enabled}


@router.get("/me")
def me(request: Request, response: Response, user: User = Depends(current_user)):
    # sliding expiry: renew the session when less than half of its lifetime is left
    expires = getattr(request.state, "session_expires", None)
    if config.settings.auth_enabled and expires:
        half = timedelta(days=config.settings.session_days / 2)
        if datetime.fromisoformat(expires) - _now() < half:
            token = request.cookies[COOKIE]
            with get_db().tx() as c:
                c.execute(
                    "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                    (_iso(_now() + timedelta(days=config.settings.session_days)), _token_hash(token)),
                )
            _set_cookie(response, request, token)
    return {"user": user.public(), "authEnabled": config.settings.auth_enabled}


@router.post("/signup", status_code=201)
def signup(body: SignupBody, request: Request, response: Response):
    s = config.settings
    if not s.auth_enabled:
        raise HTTPException(400, "Accounts are disabled on this server (AUTH_ENABLED=false).")
    if not s.signup_enabled:
        raise HTTPException(403, "Sign-ups are closed on this server.")
    ip = _client_ip(request)
    if _signup_ip.blocked(ip):
        raise HTTPException(429, "Too many sign-ups from your network. Try again later.")
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    _check_new_password(body.password)

    user_id = uuid.uuid4().hex
    with get_db().tx() as c:
        if c.one("SELECT id FROM users WHERE email = ?", (email,)):
            raise HTTPException(409, "An account with this email already exists. Log in instead.")
        first_user = c.one("SELECT COUNT(*) AS n FROM users")["n"] == 0
        c.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, email, body.name.strip()[:100], hash_password(body.password), _iso(_now())),
        )
        if first_user:  # CVs saved before accounts existed belong to the first account
            c.execute("UPDATE cvs SET user_id = ? WHERE user_id IS NULL OR user_id = 'local'", (user_id,))
    _signup_ip.hit(ip)
    start_session(user_id, request, response)
    return {"user": _user_from_row({"id": user_id, "email": email, "name": body.name.strip()}).public()}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    if not config.settings.auth_enabled:
        raise HTTPException(400, "Accounts are disabled on this server.")
    email, ip = body.email.strip().lower(), _client_ip(request)
    if _fail_email.blocked(email) or _fail_ip.blocked(ip):
        raise HTTPException(429, "Too many failed attempts. Wait 15 minutes and try again.")
    with get_db().tx() as c:
        row = c.one("SELECT id, email, name, password_hash FROM users WHERE email = ?", (email,))
    ok = verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH) and row is not None
    if not ok:
        _fail_email.hit(email)
        _fail_ip.hit(ip)
        raise HTTPException(401, "Wrong email or password.")
    _fail_email.clear(email)
    start_session(row["id"], request, response)
    return {"user": _user_from_row(row).public()}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with get_db().tx() as c:
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/password")
def change_password(body: PasswordBody, request: Request, user: User = Depends(current_user)):
    if not config.settings.auth_enabled:
        raise HTTPException(400, "Accounts are disabled on this server.")
    with get_db().tx() as c:
        row = c.one("SELECT password_hash FROM users WHERE id = ?", (user.id,))
    if not row or not verify_password(body.current, row["password_hash"]):
        raise HTTPException(400, "Current password is wrong.")
    _check_new_password(body.new)
    keep = _token_hash(request.cookies.get(COOKIE, ""))
    with get_db().tx() as c:
        c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(body.new), user.id))
        # sign out every other device
        c.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", (user.id, keep))
    return {"ok": True}


@router.post("/delete-account")
def delete_account(body: DeleteBody, response: Response, user: User = Depends(current_user)):
    if not config.settings.auth_enabled:
        raise HTTPException(400, "Accounts are disabled on this server.")
    with get_db().tx() as c:
        row = c.one("SELECT password_hash FROM users WHERE id = ?", (user.id,))
        if not row or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(400, "Password is wrong.")
        for sql in (
            "DELETE FROM cvs WHERE user_id = ?",
            "DELETE FROM sessions WHERE user_id = ?",
            "DELETE FROM ai_usage WHERE user_id = ?",
            "DELETE FROM ai_keys WHERE user_id = ?",
            "DELETE FROM users WHERE id = ?",
        ):
            c.execute(sql, (user.id,))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
