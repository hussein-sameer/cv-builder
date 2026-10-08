"""Minimal database layer: SQLite by default, PostgreSQL when DATABASE_URL / POSTGRES_URI
points at one (e.g. a Northflank or Neon Postgres).

Queries are written once with ``?`` placeholders and portable SQL; the Postgres
adapter rewrites placeholders to ``%s``. Rows come back as plain dicts.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from . import config

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        last_login_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)",
    """CREATE TABLE IF NOT EXISTS cvs (
        id         TEXT PRIMARY KEY,
        user_id    TEXT,
        name       TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS ai_usage (
        user_id TEXT NOT NULL,
        day     TEXT NOT NULL,
        count   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
    )""",
]
POST_SCHEMA = ["CREATE INDEX IF NOT EXISTS cvs_user_idx ON cvs (user_id, updated_at)"]


class Conn:
    """Thin wrapper giving both drivers the same tiny API."""

    def __init__(self, raw: Any, kind: str):
        self.raw = raw
        self.kind = kind

    def execute(self, sql: str, params: tuple | list = ()) -> Any:
        if self.kind == "postgres":
            sql = sql.replace("?", "%s")
        return self.raw.execute(sql, tuple(params))

    def one(self, sql: str, params: tuple | list = ()) -> dict | None:
        row = self.execute(sql, params).fetchone()
        return dict(row) if row is not None else None

    def all(self, sql: str, params: tuple | list = ()) -> list[dict]:
        return [dict(r) for r in self.execute(sql, params).fetchall()]


class Database:
    def __init__(self, url: str):
        self.url = url
        self.kind = "postgres" if url.startswith(("postgres://", "postgresql://")) else "sqlite"
        self._pool = None
        if self.kind == "postgres":
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool

            self._pool = ConnectionPool(url, min_size=1, max_size=5, kwargs={"row_factory": dict_row}, open=True)
        else:
            path = url.removeprefix("sqlite:///") if url.startswith("sqlite:///") else url
            self.path = path
            if path != ":memory:":
                Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def tx(self) -> Iterator[Conn]:
        """One transaction: commits on success, rolls back on error."""
        if self._pool is not None:
            with self._pool.connection() as raw:  # psycopg commits/rolls back on exit
                yield Conn(raw, "postgres")
            return
        raw = sqlite3.connect(self.path, timeout=15)
        raw.row_factory = sqlite3.Row
        try:
            raw.execute("PRAGMA journal_mode=WAL")
            raw.execute("PRAGMA foreign_keys=ON")
            yield Conn(raw, "sqlite")
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    def _init_schema(self) -> None:
        with self.tx() as c:
            for stmt in SCHEMA:
                c.execute(stmt)
            if self.kind == "sqlite":  # upgrade pre-auth databases (cvs had no user_id)
                cols = {r["name"] for r in c.all("PRAGMA table_info(cvs)")}
                if "user_id" not in cols:
                    c.execute("ALTER TABLE cvs ADD COLUMN user_id TEXT")
            for stmt in POST_SCHEMA:
                c.execute(stmt)

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()


_db: Database | None = None
_lock = threading.Lock()


def get_db() -> Database:
    global _db
    if _db is None:
        with _lock:
            if _db is None:
                _db = Database(config.settings.database_url)
    return _db


def configure(url: str) -> Database:
    """Point the app at another database (used by tests)."""
    global _db
    with _lock:
        if _db is not None:
            _db.close()
        _db = Database(url)
    return _db


def close_db() -> None:
    global _db
    with _lock:
        if _db is not None:
            _db.close()
            _db = None
