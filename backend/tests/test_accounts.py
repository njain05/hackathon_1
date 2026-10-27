"""Sign in with a username and password: every role gets the access its pages already use."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import db
from app.main import app
from solver import SolveResult, sample_college

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path) -> Iterator[None]:
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    yield


def college(result: SolveResult) -> dict[str, Any]:
    data = sample_college().model_dump(mode="json")
    c = client.post("/colleges", json={"name": "Test College", "data": data}).json()
    admin = {"X-Admin-Key": c["admin_key"]}
    assert client.post(f"/colleges/{c['code']}/publish", json={"data": data, "result": result.model_dump(mode="json")}, headers=admin).status_code == 200
    return {"code": c["code"], "admin": admin, "key": c["admin_key"]}


def login(code: str, username: str, password: str) -> Any:
    return client.post(f"/colleges/{code}/login", json={"username": username, "password": password})


def test_dean_signs_in_and_gets_the_admin_key(sample_result: SolveResult) -> None:
    c = college(sample_result)
    assert client.post(f"/colleges/{c['code']}/accounts/dean", json={"username": "Dean.Office", "password": "short"}, headers=c["admin"]).status_code == 422
    res = client.post(f"/colleges/{c['code']}/accounts/dean", json={"username": "Dean.Office", "password": "Ludhiana-2026"}, headers=c["admin"])
    assert res.status_code == 200 and res.json()["username"] == "dean.office"

    r = login(c["code"].lower(), " DEAN.office ", "Ludhiana-2026")
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "dean" and r.json()["key"] == c["key"]
    assert client.get(f"/colleges/{c['code']}/admin", headers={"X-Admin-Key": r.json()["key"]}).status_code == 200
    # Wrong password, unknown user and unknown college all say the same thing.
    for code, user, pw in ((c["code"], "dean.office", "nope-nope"), (c["code"], "nobody", "x"), ("ZZZZZZ", "dean.office", "Ludhiana-2026")):
        bad = login(code, user, pw)
        assert bad.status_code == 401 and "Wrong username or password" in bad.json()["detail"]
    # The stored row holds neither the password nor the key in the clear.
    assert db._sessions is not None
    with db._sessions() as s:
        row = s.execute(text("select password_hash, key_box from accounts")).one()
        assert "Ludhiana" not in row[0] and c["key"] not in row[1] and c["key"].encode().hex() not in row[1]


def test_staff_and_students_sign_in_to_their_own_access(sample_result: SolveResult) -> None:
    c = college(sample_result)
    base = f"/colleges/{c['code']}/accounts"
    hod = client.post(base, json={"role": "hod", "username": "hod.cse", "name": "Dr. CSE Head", "department_id": "CSE"}, headers=c["admin"])
    assert hod.status_code == 201, hod.text
    pw = hod.json()["password"]
    assert len(pw) == 9 and pw[4] == "-"

    r = login(c["code"], "hod.cse", pw).json()
    assert r["role"] == "hod" and r["department_id"] == "CSE"
    me = client.get(f"/colleges/{c['code']}/me", headers={"X-Member-Key": r["key"]}).json()
    assert me["role"] == "hod" and me["name"] == "Dr. CSE Head"

    teacher = client.post(base, json={"role": "teacher", "username": "hk", "teacher_id": "HK", "password": "kaur-1234"}, headers=c["admin"]).json()
    t = login(c["code"], "hk", "kaur-1234").json()
    assert teacher["name"] == "Dr. Harpreet Kaur" and t["teacher_id"] == "HK" and t["department_id"] == "CSE"
    assert client.get(f"/colleges/{c['code']}/me", headers={"X-Member-Key": t["key"]}).json()["role"] == "teacher"

    student = client.post(base, json={"role": "student", "username": "21cse045", "name": "Aman", "section_id": "CSE-3A"}, headers=c["admin"]).json()
    s = login(c["code"], "21cse045", student["password"]).json()
    assert s["role"] == "student" and s["section_id"] == "CSE-3A" and s["key"] is None

    # Unknown codes and taken usernames are refused in plain words.
    assert client.post(base, json={"role": "student", "username": "x1", "section_id": "CSE-9Z"}, headers=c["admin"]).status_code == 422
    assert client.post(base, json={"role": "student", "username": "HK", "section_id": "CSE-3A"}, headers=c["admin"]).status_code == 409
    assert client.post(base, json={"role": "student", "username": "x1", "section_id": "CSE-3A"}).status_code == 403
    listed = {a["username"]: a["role"] for a in client.get(base, headers=c["admin"]).json()}
    assert listed == {"hod.cse": "hod", "hk": "teacher", "21cse045": "student"}


def test_bulk_students_reset_delete_and_change_password(sample_result: SolveResult) -> None:
    c = college(sample_result)
    base = f"/colleges/{c['code']}/accounts"
    rows = [{"username": "21cse001", "name": "A", "section_id": "CSE-3A"}, {"username": "21cse002", "name": "B", "section_id": "CSE-9Z"},
            {"username": "21CSE001", "name": "C", "section_id": "CSE-3A"}, {"username": "21ece001", "name": "D", "section_id": "ECE-3A"}]
    out = client.post(f"{base}/bulk", json={"role": "student", "rows": rows}, headers=c["admin"]).json()
    assert [m["username"] for m in out["made"]] == ["21cse001", "21ece001"]
    assert len(out["problems"]) == 2 and out["problems"][0].startswith("Row 2 (21cse002)")

    # Change your own password; the old one stops working.
    first = out["made"][0]["password"]
    assert client.post(f"/colleges/{c['code']}/password", json={"username": "21cse001", "old_password": "wrong", "new_password": "newpass1"}).status_code == 401
    assert client.post(f"/colleges/{c['code']}/password", json={"username": "21cse001", "old_password": first, "new_password": "newpass1"}).status_code == 204
    assert login(c["code"], "21cse001", first).status_code == 401
    assert login(c["code"], "21cse001", "newpass1").status_code == 200

    # A teacher's reset gives a new password and a new key; the old key stops working.
    client.post(base, json={"role": "teacher", "username": "hk", "teacher_id": "HK", "password": "kaur-1234"}, headers=c["admin"])
    old_key = login(c["code"], "hk", "kaur-1234").json()["key"]
    new = client.post(f"{base}/hk/reset", headers=c["admin"]).json()
    assert login(c["code"], "hk", "kaur-1234").status_code == 401
    new_key = login(c["code"], "hk", new["password"]).json()["key"]
    assert client.get(f"/colleges/{c['code']}/me", headers={"X-Member-Key": old_key}).status_code == 403
    assert client.get(f"/colleges/{c['code']}/me", headers={"X-Member-Key": new_key}).status_code == 200

    assert client.delete(f"{base}/hk", headers=c["admin"]).status_code == 204
    assert login(c["code"], "hk", new["password"]).status_code == 401
    assert client.get(f"/colleges/{c['code']}/me", headers={"X-Member-Key": new_key}).status_code == 403


def test_hod_makes_the_incharge_and_too_many_tries_lock(sample_result: SolveResult) -> None:
    c = college(sample_result)
    base = f"/colleges/{c['code']}"
    pw = client.post(f"{base}/accounts", json={"role": "hod", "username": "hod.cse", "department_id": "CSE"}, headers=c["admin"]).json()["password"]
    hod_key = login(c["code"], "hod.cse", pw).json()["key"]
    made = client.post(f"{base}/departments/CSE/incharge-account", json={"username": "rk", "name": "Prof. Rajesh Kumar"}, headers={"X-Member-Key": hod_key})
    assert made.status_code == 201, made.text
    inc = login(c["code"], "rk", made.json()["password"]).json()
    assert inc["role"] == "incharge"
    # The in-charge can edit their department; another department's HOD can't appoint here.
    assert client.get(f"{base}/departments/CSE/setup", headers={"X-Member-Key": inc["key"]}).status_code in (200, 404)
    assert client.post(f"{base}/departments/ECE/incharge-account", json={"username": "x2", "name": "X"}, headers={"X-Member-Key": hod_key}).status_code == 403
    # A new in-charge replaces the old one: the old sign-in says so.
    again = client.post(f"{base}/departments/CSE/incharge-account", json={"username": "ns", "name": "Dr. Neha Sharma"}, headers={"X-Member-Key": hod_key})
    assert again.status_code == 201
    replaced = login(c["code"], "rk", made.json()["password"])
    assert replaced.status_code == 403 and "replaced" in replaced.json()["detail"]

    for _ in range(5):
        assert login(c["code"], "hod.cse", "wrong-pass").status_code == 401
    assert login(c["code"], "hod.cse", pw).status_code == 429


def test_the_demo_college_stays_intact_but_can_still_be_tried(sample_result: SolveResult) -> None:
    c = college(sample_result)
    base = f"/colleges/{c['code']}"
    client.post(f"{base}/accounts/dean", json={"username": "dean", "password": "demo1234"}, headers=c["admin"])
    client.post(f"{base}/accounts", json={"role": "student", "username": "student", "section_id": "CSE-3A", "password": "demo1234"}, headers=c["admin"])
    client.post(f"{base}/accounts", json={"role": "hod", "username": "hod", "department_id": "CSE", "password": "demo1234"}, headers=c["admin"])
    assert client.post(f"{base}/demo", headers=c["admin"]).status_code == 204
    dean = {"X-Admin-Key": login(c["code"], "dean", "demo1234").json()["key"]}
    data = sample_college().model_dump(mode="json")

    refused = [
        client.put(f"{base}/data", json=data, headers=dean),
        client.delete(f"{base}/timetable", headers=dean),
        client.post(f"{base}/publish", json={"data": data, "result": sample_result.model_dump(mode="json")}, headers=dean),
        client.post(f"{base}/accounts/dean", json={"username": "dean", "password": "hacked99"}, headers=dean),
        client.post(f"{base}/accounts/student/reset", headers=dean),
        client.delete(f"{base}/accounts/hod", headers=dean),
        client.post(f"{base}/accounts", json={"role": "hod", "username": "newhod", "department_id": "CSE"}, headers=dean),
        client.post(f"{base}/departments/CSE/hod", json={"name": "X"}, headers=dean),
        client.post(f"{base}/password", json={"username": "student", "old_password": "demo1234", "new_password": "hacked99"}),
    ]
    for r in refused:
        assert r.status_code == 403 and "shared demo college" in r.json()["detail"], r.text
    # Still the same: everyone signs in, the timetable is live.
    assert login(c["code"], "student", "demo1234").status_code == 200
    assert client.get(f"{base}/timetable").status_code == 200
    # New students can still be tried.
    assert client.post(f"{base}/accounts", json={"role": "student", "username": "21cse009", "section_id": "CSE-3A"}, headers=dean).status_code == 201
