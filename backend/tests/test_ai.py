"""AI routes tested against a fake HTTP transport — no network or keys needed."""

import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from app import config
from app.ai import keys, prompts, providers
from app.ai import router as ai_router
from app.config import ProviderDefaults
from tests.conftest import signup

SAMPLE = json.loads((Path(__file__).parent / "sample_cv.json").read_text())
SUMMARY = "Network engineer with 8 years in fibre access networks, cutting repair time by 30% through Python automation."


class Recorder:
    def __init__(self, handler):
        self.handler = handler
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)


@pytest.fixture
def fake(monkeypatch):
    def install(handler):
        rec = Recorder(handler)
        monkeypatch.setattr(ai_router, "make_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(rec)))
        return rec

    return install


@pytest.fixture
def server_key(monkeypatch):
    """Give the server an OpenAI key, like OPENAI_API_KEY in .env."""
    provs = dict(config.settings.providers)
    provs["openai"] = ProviderDefaults("https://api.openai.com/v1", "server-secret", "gpt-test")
    monkeypatch.setattr(config, "settings", replace(config.settings, providers=provs))


def ok_chat(text=SUMMARY):
    return lambda r: httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def gen(client, provider, task="summary", **opts):
    return client.post("/api/ai/generate", json={"provider": provider, "task": task, "cv": SAMPLE, "options": opts})


# --------------------------------------------------------------------------- providers
def test_openai_compatible(client, fake):
    rec = fake(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": f"Here is your summary:\n\n\"{SUMMARY}\""}}]}))
    r = gen(client, {"type": "openai", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-test", "model": "x/y"})
    assert r.status_code == 200, r.text
    assert r.json()["text"] == SUMMARY  # preamble and quotes stripped
    req = rec.requests[0]
    assert str(req.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer sk-test"
    body = json.loads(req.content)
    assert body["model"] == "x/y" and body["messages"][0]["role"] == "system"
    assert "Northwind Fibre" in body["messages"][1]["content"]
    assert "Network Automation Engineer" in body["messages"][1]["content"]  # target role passed


def test_openai_retries_without_temperature(client, fake):
    def handler(r):
        if "temperature" in json.loads(r.content):
            return httpx.Response(400, json={"error": {"message": "Unsupported value: 'temperature'"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": SUMMARY}}]})

    rec = fake(handler)
    r = gen(client, {"type": "openai", "apiKey": "k", "model": "o-model", "temperature": 0.4})
    assert r.status_code == 200 and len(rec.requests) == 2


def test_anthropic(client, fake):
    rec = fake(lambda r: httpx.Response(200, json={"content": [{"type": "text", "text": SUMMARY}]}))
    r = gen(client, {"type": "anthropic", "apiKey": "ak", "model": "claude-x"})
    assert r.json()["text"] == SUMMARY
    req = rec.requests[0]
    assert str(req.url) == "https://api.anthropic.com/v1/messages"
    assert req.headers["x-api-key"] == "ak" and req.headers["anthropic-version"]
    body = json.loads(req.content)
    assert body["max_tokens"] > 0 and "recruiter" in body["system"]


def test_gemini(client, fake):
    rec = fake(lambda r: httpx.Response(200, json={"candidates": [{"content": {"parts": [
        {"text": "thinking...", "thought": True}, {"text": SUMMARY}]}}]}))
    r = gen(client, {"type": "gemini", "apiKey": "gk", "model": "models/gemini-x"})
    assert r.json()["text"] == SUMMARY
    req = rec.requests[0]
    assert str(req.url).endswith("/v1beta/models/gemini-x:generateContent")
    assert req.headers["x-goog-api-key"] == "gk"


def test_ollama_strips_think_and_needs_no_key(client, fake):
    rec = fake(lambda r: httpx.Response(200, json={"message": {"content": f"<think>hmm</think>\n{SUMMARY}"}}))
    r = gen(client, {"type": "ollama", "baseUrl": "http://host.docker.internal:11434", "model": "llama3.1"})
    assert r.json()["text"] == SUMMARY
    assert str(rec.requests[0].url) == "http://host.docker.internal:11434/api/chat"
    assert json.loads(rec.requests[0].content)["stream"] is False


def test_bullets_task(client, fake):
    rec = fake(ok_chat("- Led 6 engineers maintaining 4,000 km of FTTH network.\n"
                       "- Coordinated vendors during major outages, restoring service within [X hours].\n"))
    r = gen(client, {"type": "openai", "apiKey": "k", "model": "m"}, task="bullets", sectionId="s2", itemId="e1")
    assert r.status_code == 200, r.text
    assert r.json()["bullets"][1].endswith("[X hours].")
    msgs = json.loads(rec.requests[0].content)["messages"]
    assert "Entry: Senior Network Engineer at Northwind Fibre" in msgs[1]["content"]
    assert "present tense" in msgs[0]["content"]


def test_bullets_unknown_item(client, fake):
    fake(lambda r: httpx.Response(200, json={}))
    r = gen(client, {"type": "openai", "apiKey": "k", "model": "m"}, task="bullets", sectionId="nope", itemId="x")
    assert r.status_code == 400


def test_missing_key_and_model_errors(client):
    r = gen(client, {"type": "anthropic", "model": "m"})
    assert r.status_code == 400 and "API key" in r.json()["detail"]
    r = gen(client, {"type": "openai", "apiKey": "k"})
    assert r.status_code == 400 and "model" in r.json()["detail"].lower()


def test_auth_error_is_mapped(client, fake):
    fake(lambda r: httpx.Response(401, json={"error": {"message": "Invalid API key"}}))
    r = gen(client, {"type": "openai", "apiKey": "bad", "model": "m"})
    assert r.status_code == 401 and "Invalid API key" in r.json()["detail"]


def test_unreachable_provider(client, fake):
    def boom(r):
        raise httpx.ConnectError("refused")

    fake(boom)
    r = gen(client, {"type": "ollama", "model": "llama3.1"})
    assert r.status_code == 502 and "Could not reach" in r.json()["detail"]


def test_list_models(client, fake):
    fake(lambda r: httpx.Response(200, json={"models": [
        {"name": "models/gemini-a", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/embed", "supportedGenerationMethods": ["embedContent"]}]}))
    r = client.post("/api/ai/models", json={"provider": {"type": "gemini", "apiKey": "k"}})
    assert r.json()["models"] == ["gemini-a"]


def test_config_never_leaks_keys(client, server_key):
    data = client.get("/api/ai/config").json()
    assert {p["type"] for p in data["providers"]} == {"openai", "anthropic", "gemini", "ollama"}
    assert "server-secret" not in json.dumps(data)
    assert next(p for p in data["providers"] if p["type"] == "openai")["serverKey"] is True


def test_ai_requires_login(anon):
    assert gen(anon, {"type": "openai", "apiKey": "k", "model": "m"}).status_code == 401
    assert anon.get("/api/ai/config").status_code == 401


def test_clean_bullets_formats():
    raw = "Sure! Here are the bullets:\n1. First thing\n2) Second **thing**\n• Third"
    assert prompts.clean_bullets(raw) == ["First thing", "Second thing", "Third"]


# --------------------------------------------------------------------------- shared server key
def test_server_key_used_for_default_endpoint(client, fake, server_key):
    rec = fake(ok_chat())
    r = gen(client, {"type": "openai"})  # no key, no model, no base URL -> server defaults
    assert r.status_code == 200, r.text
    assert rec.requests[0].headers["authorization"] == "Bearer server-secret"
    assert r.json()["remaining"] == 29


def test_server_key_never_sent_to_custom_base_url(client, fake, server_key):
    rec = fake(ok_chat())
    r = gen(client, {"type": "openai", "baseUrl": "https://attacker.example/v1", "model": "m"})
    assert r.status_code == 200
    assert "authorization" not in rec.requests[0].headers  # the server key stayed home


def test_daily_limit_on_server_key(client, fake, server_key, settings, monkeypatch):
    s = config.settings
    monkeypatch.setattr(config, "settings", replace(s, ai_daily_limit=2))
    fake(ok_chat())
    assert gen(client, {"type": "openai"}).json()["remaining"] == 1
    assert gen(client, {"type": "openai"}).json()["remaining"] == 0
    r = gen(client, {"type": "openai"})
    assert r.status_code == 429 and "own API key" in r.json()["detail"]
    # bringing your own key is not limited
    assert gen(client, {"type": "openai", "apiKey": "mine"}).status_code == 200
    # limits are per user
    other = signup(type(client)(client.app), email="sam@example.com")
    assert gen(other, {"type": "openai"}).status_code == 200


def test_admins_are_not_limited(client, fake, server_key, monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, ai_daily_limit=1,
                                                    admin_emails=frozenset({"alex@example.com"})))
    fake(ok_chat())
    for _ in range(3):
        r = gen(client, {"type": "openai"})
        assert r.status_code == 200 and r.json()["remaining"] is None


# --------------------------------------------------------------------------- SSRF guard
def test_private_addresses_blocked_when_hosted(client, fake, monkeypatch):
    monkeypatch.setattr(config, "settings", replace(config.settings, allow_private_base_urls=False))
    fake(ok_chat())
    for ip in ("127.0.0.1", "10.1.2.3", "169.254.169.254", "::1"):
        monkeypatch.setattr(providers, "_host_ips", lambda host, ip=ip: {ip})
        r = gen(client, {"type": "openai", "baseUrl": "https://looks-public.example/v1", "apiKey": "k", "model": "m"})
        assert r.status_code == 400 and "private" in r.json()["detail"], ip
    monkeypatch.setattr(providers, "_host_ips", lambda host: {"93.184.216.34"})
    r = gen(client, {"type": "openai", "baseUrl": "https://api.example.com/v1", "apiKey": "k", "model": "m"})
    assert r.status_code == 200


# --------------------------------------------------------------------------- per-user saved keys
OR_URL = "https://openrouter.ai/api/v1"
MY_KEY = "sk-or-v1-0123456789abcd"


def save_key(client, provider):
    return client.put("/api/ai/keys", json={"provider": provider})


def test_saved_key_is_used_and_never_returned(client, fake, settings, database):
    settings(secret_key="test-secret")
    r = save_key(client, {"type": "openai", "baseUrl": OR_URL + "/", "apiKey": MY_KEY})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["baseUrl"] == OR_URL and saved["hint"] == "••••abcd" and saved["provider"] == "openai"
    listed = client.get("/api/ai/keys").json()
    assert [k["id"] for k in listed] == [saved["id"]]
    assert MY_KEY not in json.dumps(listed) + json.dumps(client.get("/api/ai/config").json())
    with database.tx() as c:
        assert MY_KEY not in c.one("SELECT key_enc FROM ai_keys")["key_enc"]  # encrypted at rest

    rec = fake(ok_chat())
    assert gen(client, {"type": "openai", "baseUrl": OR_URL, "model": "m"}).status_code == 200
    assert rec.requests[-1].headers["authorization"] == f"Bearer {MY_KEY}"
    # a key typed in the request still wins
    gen(client, {"type": "openai", "baseUrl": OR_URL, "apiKey": "typed", "model": "m"})
    assert rec.requests[-1].headers["authorization"] == "Bearer typed"
    # model listing uses it too
    fake(lambda r: httpx.Response(200, json={"data": [{"id": "a"}]}))
    assert client.post("/api/ai/models", json={"provider": {"type": "openai", "baseUrl": OR_URL}}).json()["models"] == ["a"]


def test_saved_key_only_goes_to_its_own_base_url(client, fake, settings, database):
    settings(secret_key="test-secret")
    save_key(client, {"type": "openai", "baseUrl": OR_URL, "apiKey": MY_KEY})
    rec = fake(ok_chat())
    assert gen(client, {"type": "openai", "baseUrl": "https://attacker.example/v1", "model": "m"}).status_code == 200
    assert "authorization" not in rec.requests[-1].headers
    # rebinding the stored ciphertext to another URL in the database doesn't work either
    with database.tx() as c:
        c.execute("UPDATE ai_keys SET base_url = ?", ("https://attacker.example/v1",))
    r = gen(client, {"type": "openai", "baseUrl": "https://attacker.example/v1", "model": "m"})
    assert r.status_code == 400 and "can't be read" in r.json()["detail"]
    assert len(rec.requests) == 1


def test_saved_key_beats_shared_key_and_is_not_limited(client, fake, settings, server_key, monkeypatch):
    settings(secret_key="test-secret")
    monkeypatch.setattr(config, "settings", replace(config.settings, ai_daily_limit=1))
    assert save_key(client, {"type": "openai", "apiKey": MY_KEY}).json()["baseUrl"] == "https://api.openai.com/v1"
    rec = fake(ok_chat())
    for _ in range(3):
        r = gen(client, {"type": "openai"})
        assert r.status_code == 200 and r.json()["remaining"] is None
        assert rec.requests[-1].headers["authorization"] == f"Bearer {MY_KEY}"


def test_saved_keys_are_private_to_each_user(client, fake, settings):
    settings(secret_key="test-secret")
    mine = save_key(client, {"type": "anthropic", "apiKey": MY_KEY}).json()
    other = signup(type(client)(client.app), email="sam@example.com")
    assert other.get("/api/ai/keys").json() == []
    r = gen(other, {"type": "anthropic", "model": "m"})
    assert r.status_code == 400 and "API key" in r.json()["detail"]
    assert other.delete(f"/api/ai/keys/{mine['id']}").status_code == 404
    assert len(client.get("/api/ai/keys").json()) == 1


def test_replace_and_delete_saved_key(client, fake, settings):
    settings(secret_key="test-secret")
    first = save_key(client, {"type": "gemini", "apiKey": "first-key-0000"}).json()
    second = save_key(client, {"type": "gemini", "apiKey": "second-key-1111"}).json()
    assert first["id"] == second["id"] and second["hint"] == "••••1111"
    rec = fake(lambda r: httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": SUMMARY}]}}]}))
    assert gen(client, {"type": "gemini", "model": "g"}).status_code == 200
    assert rec.requests[-1].headers["x-goog-api-key"] == "second-key-1111"
    assert client.delete(f"/api/ai/keys/{first['id']}").status_code == 204
    assert client.get("/api/ai/keys").json() == []
    r = gen(client, {"type": "gemini", "model": "g"})
    assert r.status_code == 400 and "API key" in r.json()["detail"] and len(rec.requests) == 1


def test_save_key_validation(client, settings, monkeypatch):
    settings(secret_key="test-secret")
    assert save_key(client, {"type": "openai", "apiKey": "  "}).status_code == 400
    assert save_key(client, {"type": "openai", "baseUrl": "ftp://x", "apiKey": MY_KEY}).status_code == 400
    settings(allow_private_base_urls=False)
    monkeypatch.setattr(providers, "_host_ips", lambda host: {"10.0.0.5"})
    r = save_key(client, {"type": "openai", "baseUrl": "https://intranet.example/v1", "apiKey": MY_KEY})
    assert r.status_code == 400 and "private" in r.json()["detail"]
    monkeypatch.setattr(providers, "_host_ips", lambda host: {"93.184.216.34"})
    monkeypatch.setattr(keys, "MAX_KEYS_PER_USER", 1)
    assert save_key(client, {"type": "openai", "apiKey": MY_KEY}).status_code == 200
    assert save_key(client, {"type": "openai", "apiKey": "replacing-is-fine"}).status_code == 200
    r = save_key(client, {"type": "anthropic", "apiKey": MY_KEY})
    assert r.status_code == 400 and "up to 1" in r.json()["detail"]


def test_key_file_fallback_for_sqlite(client, fake, settings, database):
    if database.kind != "sqlite":
        pytest.skip("key file is only used with SQLite")
    assert client.get("/api/ai/config").json()["keyStorage"] is True
    assert save_key(client, {"type": "anthropic", "apiKey": MY_KEY}).status_code == 200
    key_file = Path(database.path).parent / "secret.key"
    assert key_file.stat().st_mode & 0o777 == 0o600
    rec = fake(lambda r: httpx.Response(200, json={"content": [{"type": "text", "text": SUMMARY}]}))
    assert gen(client, {"type": "anthropic", "model": "c"}).status_code == 200
    assert rec.requests[-1].headers["x-api-key"] == MY_KEY
    # a different master key can't read it: the user is asked to paste it again
    settings(secret_key="a-new-secret")
    r = gen(client, {"type": "anthropic", "model": "c"})
    assert r.status_code == 400 and "Paste it again" in r.json()["detail"]


def test_postgres_needs_secret_key_to_save(client, settings, monkeypatch):
    monkeypatch.setattr(keys, "_key_file", lambda: None)  # as on Postgres
    assert client.get("/api/ai/config").json()["keyStorage"] is False
    r = save_key(client, {"type": "openai", "apiKey": MY_KEY})
    assert r.status_code == 503 and "SECRET_KEY" in r.json()["detail"]
    settings(secret_key="test-secret")
    assert client.get("/api/ai/config").json()["keyStorage"] is True
    assert save_key(client, {"type": "openai", "apiKey": MY_KEY}).status_code == 200


def test_saved_keys_deleted_with_account(client, settings, database):
    settings(secret_key="test-secret")
    save_key(client, {"type": "openai", "apiKey": MY_KEY})
    assert client.post("/api/auth/delete-account", json={"password": "correct horse"}).status_code == 200
    with database.tx() as c:
        assert c.one("SELECT COUNT(*) AS n FROM ai_keys")["n"] == 0


def test_saved_keys_require_login(anon):
    assert anon.get("/api/ai/keys").status_code == 401
    assert anon.put("/api/ai/keys", json={"provider": {"type": "openai", "apiKey": "k"}}).status_code == 401
    assert anon.delete("/api/ai/keys/abc").status_code == 401
