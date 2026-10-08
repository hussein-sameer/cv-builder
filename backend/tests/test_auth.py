import hashlib
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.auth import COOKIE, hash_password, verify_password
from app.main import app
from tests.conftest import signup


def test_password_hashing():
    h = hash_password("correct horse")
    assert h.startswith("scrypt$") and "correct horse" not in h
    assert verify_password("correct horse", h)
    assert not verify_password("wrong", h)
    assert hash_password("correct horse") != h  # salted
    assert not verify_password("x", "garbage")


def test_signup_sets_secure_session_cookie(anon, database):
    r = anon.post("/api/auth/signup", json={"email": " Alex@Example.com ", "password": "correct horse", "name": "Alex"})
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "alex@example.com"
    cookie = r.headers["set-cookie"].lower()
    assert f"{COOKIE}=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    me = anon.get("/api/auth/me").json()
    assert me["user"]["name"] == "Alex" and me["authEnabled"] is True
    # only a hash of the token is stored
    token = anon.cookies.get(COOKIE)
    with database.tx() as c:
        stored = c.one("SELECT token_hash FROM sessions")["token_hash"]
    assert stored == hashlib.sha256(token.encode()).hexdigest() and stored != token


def test_cookie_secure_behind_https(anon):
    https = TestClient(app, base_url="https://cv.example.com")
    r = https.post("/api/auth/signup", json={"email": "a@b.co", "password": "correct horse"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_signup_validation(anon):
    assert anon.post("/api/auth/signup", json={"email": "nope", "password": "correct horse"}).status_code == 400
    assert anon.post("/api/auth/signup", json={"email": "a@b.co", "password": "short"}).status_code == 400
    signup(anon, email="a@b.co")
    r = TestClient(app).post("/api/auth/signup", json={"email": "A@B.co", "password": "correct horse"})
    assert r.status_code == 409


def test_signup_can_be_closed(anon, settings):
    settings(signup_enabled=False)
    assert anon.post("/api/auth/signup", json={"email": "a@b.co", "password": "correct horse"}).status_code == 403
    assert anon.get("/api/auth/config").json() == {"authEnabled": True, "signupEnabled": False}


def test_login_logout(client):
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "alex@example.com", "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "ALEX@example.com", "password": "correct horse"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_unknown_email_and_wrong_password_look_the_same(anon):
    signup(anon)
    anon.post("/api/auth/logout")
    a = anon.post("/api/auth/login", json={"email": "ghost@example.com", "password": "correct horse"})
    b = anon.post("/api/auth/login", json={"email": "alex@example.com", "password": "wrong password"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_login_throttling(anon):
    signup(anon)
    anon.post("/api/auth/logout")
    for _ in range(8):
        assert anon.post("/api/auth/login", json={"email": "alex@example.com", "password": "bad"}).status_code == 401
    r = anon.post("/api/auth/login", json={"email": "alex@example.com", "password": "correct horse"})
    assert r.status_code == 429


def test_change_password_signs_out_other_devices(client):
    laptop = TestClient(app)
    assert laptop.post("/api/auth/login", json={"email": "alex@example.com", "password": "correct horse"}).status_code == 200
    assert client.post("/api/auth/password", json={"current": "wrong", "new": "new password!"}).status_code == 400
    assert client.post("/api/auth/password", json={"current": "correct horse", "new": "new password!"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # this device stays signed in
    assert laptop.get("/api/auth/me").status_code == 401  # other device signed out
    fresh = TestClient(app)
    assert fresh.post("/api/auth/login", json={"email": "alex@example.com", "password": "correct horse"}).status_code == 401
    assert fresh.post("/api/auth/login", json={"email": "alex@example.com", "password": "new password!"}).status_code == 200


def test_delete_account_removes_data(client, sample, database):
    client.post("/api/cvs", json={"name": "Mine", "data": sample})
    assert client.post("/api/auth/delete-account", json={"password": "wrong"}).status_code == 400
    assert client.post("/api/auth/delete-account", json={"password": "correct horse"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    with database.tx() as c:
        assert c.one("SELECT COUNT(*) AS n FROM cvs")["n"] == 0
        assert c.one("SELECT COUNT(*) AS n FROM users")["n"] == 0


def test_expired_session_is_rejected(client, database):
    with database.tx() as c:
        c.execute("UPDATE sessions SET expires_at = ?", (datetime(2000, 1, 1, tzinfo=timezone.utc).isoformat(),))
    assert client.get("/api/cvs").status_code == 401


def test_first_account_claims_cvs_saved_before_auth(anon, database, sample):
    with database.tx() as c:
        c.execute("INSERT INTO cvs (id, user_id, name, data, created_at, updated_at) VALUES ('old1', NULL, 'Old CV', '{}', 'x', 'x')")
    signup(anon)
    assert [c["name"] for c in anon.get("/api/cvs").json()] == ["Old CV"]
    second = signup(TestClient(app), email="sam@example.com")
    assert second.get("/api/cvs").json() == []


def test_cross_site_writes_blocked(client):
    r = client.post("/api/cvs", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/cvs", json={"name": "x"}, headers={"Origin": "http://testserver"})
    assert r.status_code == 201


def test_auth_disabled_runs_as_local_user(anon, settings, sample):
    settings(auth_enabled=False)
    assert anon.get("/api/auth/me").json()["authEnabled"] is False
    assert anon.post("/api/cvs", json={"name": "Local", "data": sample}).status_code == 201
    assert anon.post("/api/export/pdf", json=sample).status_code == 200


def test_security_headers(anon):
    r = anon.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"


def test_oversized_body_rejected(client):
    r = client.post("/api/cvs", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(5 * 1024 * 1024)})
    assert r.status_code == 413
