"""Departments run their own part of the setup: in-charge links, scoped saves,
ready flags and room sharing approved by the room's HOD."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from solver import SolveResult, sample_college

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path) -> Iterator[None]:
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    yield


def setup_college(result: SolveResult) -> dict[str, Any]:
    """A college with the sample saved online, published, and HODs for CSE and ECE."""
    data = sample_college().model_dump(mode="json")
    c = client.post("/colleges", json={"name": "Test College", "data": data}).json()
    admin = {"X-Admin-Key": c["admin_key"]}
    pub = client.post(f"/colleges/{c['code']}/publish", json={"data": data, "result": result.model_dump(mode="json")}, headers=admin)
    assert pub.status_code == 200
    heads = {}
    for dept, name in (("CSE", "Dr. CSE Head"), ("ECE", "Dr. ECE Head")):
        res = client.post(f"/colleges/{c['code']}/departments/{dept}/hod", json={"name": name}, headers=admin)
        assert res.status_code == 200, res.text
        heads[dept] = {"X-Member-Key": res.json()["key"]}
    return {"code": c["code"], "admin": admin, "hod": heads}


def make_incharge(code: str, headers: dict[str, str], dept: str = "CSE", name: str = "Prof. Rajesh Kumar") -> dict[str, str]:
    res = client.post(f"/colleges/{code}/departments/{dept}/incharge", json={"name": name, "teacher_id": "RK"}, headers=headers)
    assert res.status_code == 200, res.text
    return {"X-Member-Key": res.json()["key"]}


def test_hod_appoints_incharge_who_edits_only_their_department(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    incharge = make_incharge(c["code"], c["hod"]["CSE"])

    got = client.get(f"/colleges/{c['code']}/departments/CSE/setup", headers=incharge)
    assert got.status_code == 200
    assert got.json()["role"] == "incharge"
    data = got.json()["data"]

    for t in data["teachers"]:
        if t["id"] == "HK":
            t["name"] = "Dr. Harpreet Kaur Sandhu"  # CSE: allowed
        if t["id"] == "BS":
            t["name"] = "Changed by CSE"  # ECE: not theirs
    data["settings"]["periods_per_day"] = 9  # admin only
    saved = client.put(f"/colleges/{c['code']}/departments/CSE/setup", json={"data": data}, headers=incharge)
    assert saved.status_code == 200, saved.text
    notes = " ".join(saved.json()["ignored"])
    assert "teachers" in notes and "only the Dean" in notes

    after = client.get(f"/colleges/{c['code']}/admin", headers=c["admin"]).json()["data"]
    names = {t["id"]: t["name"] for t in after["teachers"]}
    assert names["HK"] == "Dr. Harpreet Kaur Sandhu"
    assert names["BS"] == "Dr. Baljit Singh"
    assert after["settings"]["periods_per_day"] == 7

    # Another department's setup is off limits.
    assert client.get(f"/colleges/{c['code']}/departments/ECE/setup", headers=incharge).status_code == 403


def test_department_cannot_take_another_departments_code_or_move_rows_out(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    incharge = make_incharge(c["code"], c["hod"]["CSE"])
    data = client.get(f"/colleges/{c['code']}/departments/CSE/setup", headers=incharge).json()["data"]

    clash = {**data, "teachers": [*data["teachers"], {"id": "BS", "name": "Someone", "department_id": "CSE", "max_periods_per_day": None, "unavailable": []}]}
    res = client.put(f"/colleges/{c['code']}/departments/CSE/setup", json={"data": clash}, headers=incharge)
    assert res.status_code == 409 and "already used" in res.json()["detail"]

    for t in data["teachers"]:
        if t["id"] == "HK":
            t["department_id"] = "ECE"
    res = client.put(f"/colleges/{c['code']}/departments/CSE/setup", json={"data": data}, headers=incharge)
    assert res.status_code == 200
    assert any("only be moved" in n for n in res.json()["ignored"])
    after = client.get(f"/colleges/{c['code']}/admin", headers=c["admin"]).json()["data"]
    assert next(t for t in after["teachers"] if t["id"] == "HK")["department_id"] == "CSE"


def test_new_incharge_link_replaces_the_old_and_only_hod_or_admin_can_appoint(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    first = make_incharge(c["code"], c["hod"]["CSE"])
    # An in-charge can't appoint, nor can another department's HOD.
    assert client.post(f"/colleges/{c['code']}/departments/CSE/incharge", json={"name": "X"}, headers=first).status_code == 403
    assert client.post(f"/colleges/{c['code']}/departments/CSE/incharge", json={"name": "X"}, headers=c["hod"]["ECE"]).status_code == 403
    second = make_incharge(c["code"], c["admin"], name="Dr. Neha Sharma")
    assert client.get(f"/colleges/{c['code']}/departments/CSE/setup", headers=first).status_code == 403
    assert client.get(f"/colleges/{c['code']}/departments/CSE/setup", headers=second).status_code == 200
    info = client.get(f"/colleges/{c['code']}/departments/CSE/incharge", headers=c["hod"]["CSE"]).json()
    assert info["name"] == "Dr. Neha Sharma" and info["key"] is None
    assert client.get(f"/colleges/{c['code']}/departments/CSE/setup", headers={"X-Member-Key": "nonsense"}).status_code == 403


def status_of(code: str, headers: dict[str, str]) -> dict[str, dict[str, Any]]:
    res = client.get(f"/colleges/{code}/departments/status", headers=headers)
    assert res.status_code == 200, res.text
    return {s["department_id"]: s for s in res.json()}


def test_incharge_sends_to_hod_who_approves_or_sends_back(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    code = c["code"]
    incharge = make_incharge(code, c["hod"]["CSE"])
    base = f"/colleges/{code}/departments/CSE"

    assert status_of(code, c["admin"])["CSE"]["state"] == "draft"
    # The in-charge can't approve, nor can another department's HOD; nothing to send back yet.
    assert client.post(f"{base}/review", json={"approve": True}, headers=incharge).status_code == 403
    assert client.post(f"{base}/review", json={"approve": True}, headers=c["hod"]["ECE"]).status_code == 403
    assert client.post(f"{base}/review", json={"approve": False, "note": "x"}, headers=c["hod"]["CSE"]).status_code == 409

    sent = client.post(f"{base}/submit", json={}, headers=incharge)
    assert sent.status_code == 200 and sent.json()["state"] == "submitted"
    assert client.post(f"{base}/submit", json={}, headers=incharge).status_code == 409
    # Sending back needs a note saying what to fix.
    assert client.post(f"{base}/review", json={"approve": False}, headers=c["hod"]["CSE"]).status_code == 422
    back = client.post(f"{base}/review", json={"approve": False, "note": "Add the CS301 lab"}, headers=c["hod"]["CSE"])
    assert back.status_code == 200 and back.json()["state"] == "returned" and back.json()["note"] == "Add the CS301 lab"

    assert client.post(f"{base}/submit", json={}, headers=incharge).json()["state"] == "submitted"
    ok = client.post(f"{base}/review", json={"approve": True}, headers=c["hod"]["CSE"])
    assert ok.status_code == 200 and ok.json()["state"] == "approved" and ok.json()["updated_by"] == "Dr. CSE Head"
    assert client.post(f"{base}/submit", json={}, headers=incharge).status_code == 409

    dean = status_of(code, c["admin"])
    assert dean["CSE"]["state"] == "approved" and dean["ECE"]["state"] == "draft"
    # Both departments have an HOD, so the Dean waits for both.
    assert dean["CSE"]["needs_approval"] and dean["ECE"]["needs_approval"]


def test_changing_approved_data_puts_it_back_to_draft(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    code = c["code"]
    incharge = make_incharge(code, c["hod"]["CSE"])
    base = f"/colleges/{code}/departments/CSE"
    client.post(f"{base}/review", json={"approve": True}, headers=c["hod"]["CSE"])  # the HOD may approve a draft directly
    data = client.get(f"{base}/setup", headers=incharge).json()["data"]

    # Saving with no real change keeps the approval.
    same = client.put(f"{base}/setup", json={"data": data}, headers=incharge)
    assert same.status_code == 200 and same.json()["reopened"] is False
    assert status_of(code, c["admin"])["CSE"]["state"] == "approved"

    # A change to another department's rows is ignored, so it doesn't count either.
    for t in data["teachers"]:
        if t["id"] == "BS":
            t["name"] = "Changed by CSE"
    assert client.put(f"{base}/setup", json={"data": data}, headers=incharge).json()["reopened"] is False

    for t in data["teachers"]:
        if t["id"] == "HK":
            t["max_periods_per_day"] = 4
    changed = client.put(f"{base}/setup", json={"data": data}, headers=incharge)
    assert changed.json()["reopened"] is True
    assert status_of(code, c["admin"])["CSE"]["state"] == "draft"

    # The Dean's own changes don't undo an HOD's approval.
    client.post(f"{base}/review", json={"approve": True}, headers=c["hod"]["CSE"])
    for t in data["teachers"]:
        if t["id"] == "HK":
            t["max_periods_per_day"] = 5
    assert client.put(f"{base}/setup", json={"data": data}, headers=c["admin"]).json()["reopened"] is False
    assert status_of(code, c["admin"])["CSE"]["state"] == "approved"


def test_status_shows_other_departments_progress_but_not_their_people(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    code = c["code"]
    make_incharge(code, c["hod"]["CSE"])
    client.post(f"/colleges/{code}/departments/ECE/review", json={"approve": True, "note": "Looks right"}, headers=c["hod"]["ECE"])

    dean = status_of(code, c["admin"])
    assert dean["CSE"]["hod"] == "Dr. CSE Head" and dean["CSE"]["incharge"] == "Prof. Rajesh Kumar"
    assert dean["ECE"]["hod"] == "Dr. ECE Head" and dean["ECE"]["updated_by"] == "Dr. ECE Head"

    cse = status_of(code, c["hod"]["CSE"])
    assert cse["CSE"]["hod"] == "Dr. CSE Head" and cse["CSE"]["incharge"] == "Prof. Rajesh Kumar"
    assert cse["ECE"]["state"] == "approved"  # progress is fine to see
    assert cse["ECE"]["hod"] is None and cse["ECE"]["incharge"] is None
    assert cse["ECE"]["updated_by"] == "" and cse["ECE"]["note"] == ""


def test_room_sharing_needs_the_owning_hods_approval(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    cse_incharge = make_incharge(c["code"], c["hod"]["CSE"])
    code = c["code"]

    # ECE asks for CSE's room C-101.
    res = client.post(f"/colleges/{code}/room-requests", json={"room_id": "C-101", "for_department": "ECE", "reason": "Open elective"}, headers=c["hod"]["ECE"])
    assert res.status_code == 201, res.text
    req = res.json()
    assert req["owner_department"] == "CSE" and req["status"] == "pending"
    again = client.post(f"/colleges/{code}/room-requests", json={"room_id": "C-101", "for_department": "ECE"}, headers=c["hod"]["ECE"])
    assert again.status_code == 409
    # A shared room needs no approval; another department can't ask on ECE's behalf.
    assert client.post(f"/colleges/{code}/room-requests", json={"room_id": "LT-1", "for_department": "ECE"}, headers=c["hod"]["ECE"]).status_code == 409
    assert client.post(f"/colleges/{code}/room-requests", json={"room_id": "E-201", "for_department": "ECE"}, headers=cse_incharge).status_code == 403

    # CSE sees it; only CSE's HOD (or the admin) can decide.
    assert [r["id"] for r in client.get(f"/colleges/{code}/room-requests", headers=cse_incharge).json()] == [req["id"]]
    decide = f"/colleges/{code}/room-requests/{req['id']}/decide"
    assert client.post(decide, json={"approve": True}, headers=cse_incharge).status_code == 403
    assert client.post(decide, json={"approve": True}, headers=c["hod"]["ECE"]).status_code == 403
    ok = client.post(decide, json={"approve": True, "note": "Fine on Fridays"}, headers=c["hod"]["CSE"])
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert client.post(decide, json={"approve": False}, headers=c["hod"]["CSE"]).status_code == 409

    after = client.get(f"/colleges/{code}/admin", headers=c["admin"]).json()["data"]
    assert next(r for r in after["rooms"] if r["id"] == "C-101")["shared_with"] == ["ECE"]


def test_two_people_editing_one_department_never_overwrite_each_other(sample_result: SolveResult) -> None:
    c = setup_college(sample_result)
    incharge = make_incharge(c["code"], c["hod"]["CSE"])
    url = f"/colleges/{c['code']}/departments/CSE/setup"
    hod_copy = client.get(url, headers=c["hod"]["CSE"]).json()["data"]
    inc_copy = client.get(url, headers=incharge).json()["data"]

    for r in hod_copy["rooms"]:
        if r["id"] == "C-101":
            r["capacity"] = 80
    assert client.put(url, json={"data": hod_copy, "base": inc_copy}, headers=c["hod"]["CSE"]).status_code == 200

    # The in-charge's page still has the old copy: their save is refused, not merged over the HOD's.
    stale = json_copy(inc_copy)
    for r in stale["rooms"]:
        if r["id"] == "C-102":
            r["capacity"] = 70
    res = client.put(url, json={"data": stale, "base": inc_copy}, headers=incharge)
    assert res.status_code == 409 and "Reload" in res.json()["detail"]
    rooms = {r["id"]: r["capacity"] for r in client.get(url, headers=incharge).json()["data"]["rooms"]}
    assert rooms["C-101"] == 80 and rooms["C-102"] != 70


def json_copy(d: dict[str, Any]) -> dict[str, Any]:
    import json

    return json.loads(json.dumps(d))
