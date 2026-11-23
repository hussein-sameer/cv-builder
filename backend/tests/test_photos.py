"""Saved photo library: at most three per user, replace-to-make-room, never shared between users."""

import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.layout import PHOTO_PX
from app.main import app
from app.photos import MAX_PHOTOS
from conftest import signup


def _photo(colour=(40, 90, 160), size=(300, 500), fmt="PNG") -> str:
    """A synthetic test image (no real person) as a data URL."""
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


def _add(client, data, **kw):
    return client.post("/api/photos", json={"data": data, **kw})


def test_photos_are_normalised_and_listed(client):
    r = _add(client, _photo())
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["data"].startswith("data:image/jpeg;base64,")  # PNG of any size -> the printed 7:9 JPEG
    with Image.open(io.BytesIO(base64.b64decode(saved["data"].split(",", 1)[1]))) as im:
        assert im.size == PHOTO_PX
    assert client.get("/api/photos").json() == [saved]
    # the editor's own 7:9 JPEG is stored byte for byte, and saving it again doesn't take a second slot
    jpeg = _photo((10, 10, 10), PHOTO_PX, "JPEG")
    first = _add(client, jpeg).json()
    assert first["data"] == jpeg
    assert _add(client, jpeg).json()["id"] == first["id"]
    assert len(client.get("/api/photos").json()) == 2


def test_limit_of_three_and_replacing(client):
    ids = [_add(client, _photo((i * 40, 0, 0))).json()["id"] for i in range(MAX_PHOTOS)]
    r = _add(client, _photo((0, 200, 0)))
    assert r.status_code == 409 and "up to 3 photos" in r.json()["detail"]
    r = _add(client, _photo((0, 200, 0)), replaceIds=ids[:2])  # delete several and save, in one go
    assert r.status_code == 201
    assert [p["id"] for p in client.get("/api/photos").json()] == [ids[2], r.json()["id"]]
    assert client.delete(f"/api/photos/{ids[2]}").status_code == 204
    assert client.delete(f"/api/photos/{ids[2]}").status_code == 404
    assert len(client.get("/api/photos").json()) == 1


def test_bad_photos_are_rejected(client):
    assert _add(client, "https://example.com/me.jpg").status_code == 422
    assert _add(client, "").status_code == 422
    bad = "data:image/jpeg;base64," + base64.b64encode(b"not an image").decode()
    assert _add(client, bad).status_code == 400
    assert client.get("/api/photos").json() == []


def test_users_cannot_see_or_delete_each_others_photos(client):
    mine = _add(client, _photo()).json()
    other = signup(TestClient(app), email="sam@example.com")
    assert other.get("/api/photos").json() == []
    assert other.delete(f"/api/photos/{mine['id']}").status_code == 404
    # replaceIds can't delete someone else's photo to make room either
    for i in range(MAX_PHOTOS):
        assert _add(other, _photo((0, 0, i * 50))).status_code == 201
    assert _add(other, _photo((9, 9, 9)), replaceIds=[mine["id"]]).status_code == 409
    assert client.get("/api/photos").json() == [mine]


def test_photos_require_login(anon):
    assert anon.get("/api/photos").status_code == 401
    assert _add(anon, _photo()).status_code == 401
    assert anon.delete("/api/photos/abc").status_code == 401


def test_deleting_the_account_deletes_its_photos(client, database):
    _add(client, _photo())
    assert client.post("/api/auth/delete-account", json={"password": "correct horse"}).status_code == 200
    with database.tx() as c:
        assert c.all("SELECT id FROM photos") == []
