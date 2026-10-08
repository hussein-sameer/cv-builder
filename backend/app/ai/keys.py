"""Per-user AI API keys, saved to the account and encrypted at rest.

* AES-256-GCM. The master key comes from SECRET_KEY, or for SQLite installs from a
  ``secret.key`` file created next to the database (so key and data share a lifetime).
  Postgres deployments must set SECRET_KEY: their containers usually have no
  persistent disk, and a key file lost on redeploy would make every saved key unreadable.
* Each key is bound to the user, provider and base URL it was saved for (they are the
  AEAD's associated data), and is only ever sent to that base URL. Someone who steals a
  session can use the key through this server but can't redirect it to their own host.
* Keys are never returned by the API; only a short hint (last 4 characters).
"""

from __future__ import annotations

import base64
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .. import config
from ..db import get_db
from .providers import AIError

MAX_KEYS_PER_USER = 20
_VERSION = "v1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _key_file() -> Path | None:
    """Where an auto-generated master key lives, or None when one isn't safe to use."""
    database = get_db()
    if database.kind != "sqlite" or database.path == ":memory:":
        return None
    return Path(database.path).resolve().parent / "secret.key"


def _master_secret() -> bytes | None:
    if config.settings.secret_key:
        return config.settings.secret_key.encode()
    path = _key_file()
    if path is None:
        return None
    if not path.exists():
        # write a temp file, then hard-link it into place: atomic, and two workers
        # starting at once can't overwrite (or half-read) each other's key
        tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_urlsafe(32))
        try:
            os.link(tmp, path)
        except FileExistsError:
            pass
        finally:
            tmp.unlink()
    return path.read_text().strip().encode() or None


def available() -> bool:
    """Whether this server can save keys to accounts."""
    return bool(config.settings.secret_key) or _key_file() is not None


def _aead() -> AESGCM | None:
    secret = _master_secret()
    if not secret:
        return None
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"cv-builder/ai-keys/v1").derive(secret)
    return AESGCM(key)


def _aad(user_id: str, provider: str, base_url: str) -> bytes:
    return "\n".join((user_id, provider, base_url)).encode()


def _hint(api_key: str) -> str:
    return "••••" + api_key[-4:] if len(api_key) >= 12 else "••••"


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "provider": row["provider"],
        "baseUrl": row["base_url"],
        "hint": row["hint"],
        "updatedAt": row["updated_at"],
    }


def list_keys(user_id: str) -> list[dict]:
    with get_db().tx() as c:
        rows = c.all(
            "SELECT id, provider, base_url, hint, updated_at FROM ai_keys WHERE user_id = ? ORDER BY provider, base_url",
            (user_id,),
        )
    return [_public(r) for r in rows]


def save_key(user_id: str, provider: str, base_url: str, api_key: str) -> dict:
    """Encrypt and upsert the user's key for (provider, base_url)."""
    aead = _aead()
    if aead is None:
        raise AIError("This server isn't set up to save API keys (its SECRET_KEY isn't set).", 503)
    nonce = secrets.token_bytes(12)
    blob = aead.encrypt(nonce, api_key.encode(), _aad(user_id, provider, base_url))
    enc = f"{_VERSION}:{base64.urlsafe_b64encode(nonce + blob).decode()}"
    now = _now()
    with get_db().tx() as c:
        exists = c.one(
            "SELECT id FROM ai_keys WHERE user_id = ? AND provider = ? AND base_url = ?", (user_id, provider, base_url)
        )
        if not exists and c.one("SELECT COUNT(*) AS n FROM ai_keys WHERE user_id = ?", (user_id,))["n"] >= MAX_KEYS_PER_USER:
            raise AIError(f"You can save up to {MAX_KEYS_PER_USER} API keys. Remove one first.", 400)
        row = c.one(
            "INSERT INTO ai_keys (id, user_id, provider, base_url, key_enc, hint, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (user_id, provider, base_url) DO UPDATE SET "
            "key_enc = excluded.key_enc, hint = excluded.hint, updated_at = excluded.updated_at "
            "RETURNING id, provider, base_url, hint, updated_at",
            (uuid.uuid4().hex[:12], user_id, provider, base_url, enc, _hint(api_key), now, now),
        )
    return _public(row)  # type: ignore[arg-type]


def get_key(user_id: str, provider: str, base_url: str) -> str | None:
    """The user's saved key for exactly this provider and base URL, decrypted."""
    with get_db().tx() as c:
        row = c.one(
            "SELECT key_enc FROM ai_keys WHERE user_id = ? AND provider = ? AND base_url = ?",
            (user_id, provider, base_url),
        )
    if not row:
        return None
    try:
        aead = _aead()
        version, _, payload = row["key_enc"].partition(":")
        raw = base64.urlsafe_b64decode(payload)
        if aead is None or version != _VERSION or len(raw) < 13:
            raise ValueError(version)
        return aead.decrypt(raw[:12], raw[12:], _aad(user_id, provider, base_url)).decode()
    except (InvalidTag, ValueError) as exc:
        raise AIError("Your saved API key can't be read on this server any more. Paste it again in AI settings.", 400) from exc


def delete_key(user_id: str, key_id: str) -> bool:
    with get_db().tx() as c:
        return c.execute("DELETE FROM ai_keys WHERE id = ? AND user_id = ?", (key_id, user_id)).rowcount > 0
