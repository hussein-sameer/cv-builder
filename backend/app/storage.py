"""CV library storage. Every query is scoped to the owner, so users only ever see their own CVs."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .db import get_db
from .models import CV


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _meta(row: dict) -> dict:
    data = json.loads(row["data"])
    return {
        "id": row["id"],
        "name": row["name"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "headline": data.get("personal", {}).get("headline", ""),
        "targetRole": data.get("target", {}).get("role", ""),
        "template": data.get("design", {}).get("template", "international"),
    }


def list_cvs(user_id: str) -> list[dict]:
    with get_db().tx() as c:
        rows = c.all(
            "SELECT * FROM cvs WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC, id", (user_id,)
        )
    return [_meta(r) for r in rows]


def get_cv(user_id: str, cv_id: str) -> dict | None:
    with get_db().tx() as c:
        row = c.one("SELECT * FROM cvs WHERE id = ? AND user_id = ?", (cv_id, user_id))
    if not row:
        return None
    return {**_meta(row), "data": json.loads(row["data"])}


def create_cv(user_id: str, name: str, cv: CV) -> dict:
    cv_id, now = uuid.uuid4().hex[:12], _now()
    with get_db().tx() as c:
        c.execute(
            "INSERT INTO cvs (id, user_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (cv_id, user_id, name.strip() or "Untitled CV", cv.model_dump_json(), now, now),
        )
    return get_cv(user_id, cv_id)  # type: ignore[return-value]


def update_cv(user_id: str, cv_id: str, name: str | None = None, cv: CV | None = None) -> dict | None:
    sets, args = ["updated_at = ?"], [_now()]
    if name is not None:
        sets.append("name = ?")
        args.append(name.strip() or "Untitled CV")
    if cv is not None:
        sets.append("data = ?")
        args.append(cv.model_dump_json())
    with get_db().tx() as c:
        cur = c.execute(f"UPDATE cvs SET {', '.join(sets)} WHERE id = ? AND user_id = ?", (*args, cv_id, user_id))
        if cur.rowcount == 0:
            return None
    found = get_cv(user_id, cv_id)
    return {k: v for k, v in found.items() if k != "data"} if found else None


def delete_cv(user_id: str, cv_id: str) -> bool:
    with get_db().tx() as c:
        return c.execute("DELETE FROM cvs WHERE id = ? AND user_id = ?", (cv_id, user_id)).rowcount > 0
