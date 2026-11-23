"""/api/photos — each user's small library of saved CV photos (at most MAX_PHOTOS).

A CV doesn't point at a library photo: it embeds a copy of the chosen one in ``personal.photo``, so
exports, JSON downloads and the renderers keep working on the CV alone. Deleting a library photo
therefore never changes a CV that already uses it. Every query is scoped by ``user_id``.
"""

from __future__ import annotations

import base64
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from .auth import User, current_user
from .db import get_db
from .layout import PHOTO_PX, photo_jpeg
from .models import PHOTO_PATTERN

router = APIRouter(prefix="/api/photos", tags=["photos"])

MAX_PHOTOS = 3
JPEG_PREFIX = "data:image/jpeg;base64,"


class PhotoIn(BaseModel):
    data: str = Field(min_length=1, max_length=1_500_000, pattern=PHOTO_PATTERN)
    # library photos to delete in the same transaction, to make room when the library is full
    replaceIds: list[str] = Field(default_factory=list, max_length=MAX_PHOTOS)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _out(row: dict) -> dict:
    return {"id": row["id"], "data": row["data"], "createdAt": row["created_at"]}


def normalise(data_url: str) -> str | None:
    """The photo as the 7:9 JPEG data URL the renderers print, or None if it isn't a usable image.

    The editor already sends that shape; it is kept byte for byte (re-encoding would lose quality
    each time, and it lets an identical upload be recognised). Anything else, e.g. a photo from an
    imported JSON, is cropped and shrunk like the renderers do, so stored rows stay ~50 KB.
    """
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        with Image.open(io.BytesIO(raw)) as im:
            if im.format == "JPEG" and im.size == PHOTO_PX and len(raw) <= 300_000:
                return data_url if data_url.startswith(JPEG_PREFIX) else JPEG_PREFIX + base64.b64encode(raw).decode()
    except Exception:  # noqa: BLE001 - not an image we can read
        return None
    jpeg = photo_jpeg(data_url)
    return JPEG_PREFIX + base64.b64encode(jpeg).decode() if jpeg else None


@router.get("")
def list_photos(user: User = Depends(current_user)):
    with get_db().tx() as c:
        rows = c.all("SELECT * FROM photos WHERE user_id = ? ORDER BY created_at, id", (user.id,))
    return [_out(r) for r in rows]


@router.post("", status_code=201)
def add_photo(body: PhotoIn, user: User = Depends(current_user)):
    """Save a photo. With a full library, `replaceIds` deletes those first (all in one transaction)."""
    data = normalise(body.data)
    if not data:
        raise HTTPException(400, "Couldn't read that image. Use a JPG or PNG photo.")
    with get_db().tx() as c:
        for photo_id in body.replaceIds:
            c.execute("DELETE FROM photos WHERE id = ? AND user_id = ?", (photo_id, user.id))
        rows = c.all("SELECT * FROM photos WHERE user_id = ?", (user.id,))
        same = next((r for r in rows if r["data"] == data), None)
        if same:  # uploading a saved photo again doesn't use up another slot
            return _out(same)
        if len(rows) >= MAX_PHOTOS:
            raise HTTPException(409, f"You can keep up to {MAX_PHOTOS} photos. Delete one to save a new one.")
        row = {"id": uuid.uuid4().hex[:12], "data": data, "created_at": _now()}
        c.execute(
            "INSERT INTO photos (id, user_id, data, created_at) VALUES (?, ?, ?, ?)",
            (row["id"], user.id, data, row["created_at"]),
        )
    return _out(row)


@router.delete("/{photo_id}", status_code=204)
def delete_photo(photo_id: str, user: User = Depends(current_user)):
    with get_db().tx() as c:
        if c.execute("DELETE FROM photos WHERE id = ? AND user_id = ?", (photo_id, user.id)).rowcount == 0:
            raise HTTPException(404, "Photo not found")
