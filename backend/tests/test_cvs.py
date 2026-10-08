from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import signup


def test_crud_and_duplicate(client, sample):
    assert client.get("/api/cvs").json() == []
    r = client.post("/api/cvs", json={"name": "Software Engineer", "data": sample})
    assert r.status_code == 201
    sw = r.json()
    assert sw["name"] == "Software Engineer" and sw["data"]["personal"]["fullName"] == "Alex Morgan"
    assert sw["targetRole"] == "Network Automation Engineer"

    dup = client.post("/api/cvs", json={"name": "DevOps", "sourceId": sw["id"]}).json()
    assert dup["id"] != sw["id"] and dup["data"]["sections"] == sw["data"]["sections"]

    data = dup["data"]
    data["target"]["role"] = "DevOps Engineer"
    data["personal"]["headline"] = "DevOps Engineer"
    meta = client.put(f"/api/cvs/{dup['id']}", json={"data": data}).json()
    assert meta["targetRole"] == "DevOps Engineer" and "data" not in meta
    assert client.put(f"/api/cvs/{dup['id']}", json={"name": "DevOps – AWS"}).json()["name"] == "DevOps – AWS"

    assert client.get(f"/api/cvs/{sw['id']}").json()["data"]["personal"]["headline"] == "Senior Network Engineer"
    listed = client.get("/api/cvs").json()
    assert [c["name"] for c in listed] == ["DevOps – AWS", "Software Engineer"]  # most recently updated first

    assert client.delete(f"/api/cvs/{sw['id']}").status_code == 204
    assert client.get(f"/api/cvs/{sw['id']}").status_code == 404
    assert len(client.get("/api/cvs").json()) == 1


def test_validation_and_missing(client, sample):
    assert client.put("/api/cvs/nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/cvs/nope").status_code == 404
    assert client.post("/api/cvs", json={"name": "x", "sourceId": "nope"}).status_code == 404
    sample["design"]["template"] = "two-column"
    assert client.post("/api/cvs", json={"name": "x", "data": sample}).status_code == 422
    assert client.post("/api/cvs", json={"name": "  "}).json()["name"] == "Untitled CV"


def test_users_cannot_see_each_others_cvs(client, sample):
    mine = client.post("/api/cvs", json={"name": "Mine", "data": sample}).json()
    other = signup(TestClient(app), email="sam@example.com")
    assert other.get("/api/cvs").json() == []
    assert other.get(f"/api/cvs/{mine['id']}").status_code == 404
    assert other.put(f"/api/cvs/{mine['id']}", json={"name": "pwned"}).status_code == 404
    assert other.delete(f"/api/cvs/{mine['id']}").status_code == 404
    assert other.post("/api/cvs", json={"name": "x", "sourceId": mine["id"]}).status_code == 404
    assert client.get(f"/api/cvs/{mine['id']}").json()["name"] == "Mine"


def test_library_requires_login(anon):
    assert anon.get("/api/cvs").status_code == 401
    assert anon.post("/api/cvs", json={"name": "x"}).status_code == 401
