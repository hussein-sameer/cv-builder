"""Shared fixtures. Tests run on SQLite, and also on Postgres when TEST_DATABASE_URL is set."""

import json
import os
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, config, db
from app.main import app

SAMPLE = json.loads((Path(__file__).parent / "sample_cv.json").read_text())
TABLES = ("ai_usage", "sessions", "cvs", "users")
BACKENDS = ["sqlite"] + (["postgres"] if os.getenv("TEST_DATABASE_URL") else [])


@pytest.fixture(scope="session", autouse=True)
def _close_pool_at_exit():
    yield
    db.close_db()


@pytest.fixture(params=BACKENDS)
def database(request, tmp_path):
    url = f"sqlite:///{tmp_path / 'test.db'}" if request.param == "sqlite" else os.environ["TEST_DATABASE_URL"]
    database = db.configure(url)
    with database.tx() as c:
        for t in TABLES:
            c.execute(f"DELETE FROM {t}")
    auth.reset_throttles()
    yield database


@pytest.fixture
def settings(monkeypatch):
    """Patch runtime settings: settings(ai_daily_limit=2, ...)."""

    def apply(**kw):
        monkeypatch.setattr(config, "settings", replace(config.settings, **kw))

    apply(auth_enabled=True, signup_enabled=True, allow_private_base_urls=True, ai_daily_limit=30,
          admin_emails=frozenset(), cookie_secure="auto")
    return apply


def signup(client: TestClient, email="alex@example.com", password="correct horse", name="Alex"):
    r = client.post("/api/auth/signup", json={"email": email, "password": password, "name": name})
    assert r.status_code == 201, r.text
    return client


@pytest.fixture
def anon(database, settings):
    return TestClient(app)


@pytest.fixture
def client(anon):
    return signup(anon)


@pytest.fixture
def sample():
    return json.loads(json.dumps(SAMPLE))
