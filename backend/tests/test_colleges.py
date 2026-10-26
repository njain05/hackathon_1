from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from solver import SolveResult, sample_college

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path) -> Iterator[None]:
    """Each test gets its own empty SQLite database."""
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    yield


def create(name: str = "Guru Nanak Dev Engineering College", **extra: object) -> dict:
    res = client.post("/colleges", json={"name": name, **extra})
    assert res.status_code == 201
    return res.json()


def publish_body(result: SolveResult) -> dict:
    return {"data": sample_college().model_dump(mode="json"), "result": result.model_dump(mode="json")}


def test_create_save_publish_and_read_as_public(sample_result: SolveResult) -> None:
    c = create()
    assert len(c["admin_key"]) >= 40
    assert len(c["code"]) == 6
    assert c["slug"] == "guru-nanak-dev-engineering-college"
    admin = {"X-Admin-Key": c["admin_key"]}

    # Nothing published yet: a friendly 404.
    res = client.get(f"/colleges/{c['code']}/timetable")
    assert res.status_code == 404
    assert "hasn't published" in res.json()["detail"]

    # The admin autosaves a draft (incomplete data is fine) and reads it back.
    draft = {"name": "GNDEC Ludhiana", "settings": {"days": []}}
    assert client.put(f"/colleges/{c['slug']}/data", json=draft, headers=admin).status_code == 200
    back = client.get(f"/colleges/{c['code']}/admin", headers=admin).json()
    assert back["data"] == draft
    assert back["name"] == "GNDEC Ludhiana"  # the draft's name renames the college

    # Publish, then anyone can read it by code (any case) or share-link slug.
    res = client.post(f"/colleges/{c['code']}/publish", json=publish_body(sample_result), headers=admin)
    assert res.status_code == 200
    assert res.json()["version"] == 1
    for ref in (c["code"], c["code"].lower(), c["slug"]):
        pub = client.get(f"/colleges/{ref}/timetable").json()
        assert pub["version"] == 1
        assert pub["code"] == c["code"]
        assert len(pub["result"]["entries"]) == len(sample_result.entries)
        assert pub["result"]["check"]["ok"] is True
        assert pub["data"]["sections"]

    # Publishing again makes a new version live.
    client.post(f"/colleges/{c['code']}/publish", json=publish_body(sample_result), headers=admin)
    info = client.get(f"/colleges/{c['code']}").json()
    assert info["published_version"] == 2
    assert info["published_at"].endswith(("Z", "+00:00"))


def test_create_with_draft_and_unique_slugs() -> None:
    a = create("Arts College", data={"name": "Arts College"})
    b = create("Arts College")
    assert a["slug"] == "arts-college"
    assert b["slug"] == "arts-college-2"
    assert a["code"] != b["code"]
    got = client.get(f"/colleges/{a['code']}/admin", headers={"X-Admin-Key": a["admin_key"]}).json()
    assert got["data"] == {"name": "Arts College"}


def test_wrong_or_missing_admin_key_is_rejected(sample_result: SolveResult) -> None:
    c = create()
    other = create("Other College")
    for headers in ({}, {"X-Admin-Key": "wrong"}, {"X-Admin-Key": other["admin_key"]}):
        assert client.get(f"/colleges/{c['code']}/admin", headers=headers).status_code == 403
        assert client.put(f"/colleges/{c['code']}/data", json={"name": "x"}, headers=headers).status_code == 403
        res = client.post(f"/colleges/{c['code']}/publish", json=publish_body(sample_result), headers=headers)
        assert res.status_code == 403
        assert "admin link" in res.json()["detail"]
    assert client.get(f"/colleges/{c['code']}").json()["published_version"] is None


def test_public_link_cannot_edit_or_see_the_key(sample_result: SolveResult) -> None:
    c = create()
    client.post(f"/colleges/{c['code']}/publish", json=publish_body(sample_result), headers={"X-Admin-Key": c["admin_key"]})
    for path in (f"/colleges/{c['code']}", f"/colleges/{c['slug']}/timetable"):
        text = client.get(path).text
        assert c["admin_key"] not in text
        assert "admin_key" not in text
    # No write route works without the key, and there is no delete.
    assert client.put(f"/colleges/{c['slug']}/data", json={"name": "Hacked"}).status_code == 403
    assert client.delete(f"/colleges/{c['code']}").status_code == 405
    assert client.get(f"/colleges/{c['code']}").json()["name"] == "Guru Nanak Dev Engineering College"


def test_publish_refuses_clashes_and_unsolved(sample_result: SolveResult) -> None:
    c = create()
    admin = {"X-Admin-Key": c["admin_key"]}
    clashing = sample_result.model_copy(update={"entries": [*sample_result.entries, sample_result.entries[0]]})
    res = client.post(f"/colleges/{c['code']}/publish", json=publish_body(clashing), headers=admin)
    assert res.status_code == 400
    assert "wasn't published" in res.json()["detail"]

    unsolved = SolveResult(status="infeasible")
    res = client.post(f"/colleges/{c['code']}/publish", json=publish_body(unsolved), headers=admin)
    assert res.status_code == 400
    assert client.get(f"/colleges/{c['code']}").json()["published_version"] is None


def test_unknown_college_is_404() -> None:
    res = client.get("/colleges/ZZZZZZ/timetable")
    assert res.status_code == 404
    assert "ZZZZZZ" in res.json()["detail"]


def test_database_url_normalised() -> None:
    url = "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
    assert db.normalise_url(url).startswith("postgresql+psycopg://postgres.abc:pw@")
    assert db.normalise_url("postgres://u:p@h/d") == "postgresql+psycopg://u:p@h/d"
    assert db.normalise_url("sqlite:///./timetable.db") == "sqlite:///./timetable.db"
