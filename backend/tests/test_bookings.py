from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from solver import SolveResult, sample_college

client = TestClient(app)

# A Monday at least a week ahead, so "date has passed" never triggers.
MONDAY = date.today() + timedelta(days=7 + (7 - date.today().weekday()) % 7)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path) -> Iterator[None]:
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    yield


@pytest.fixture
def college(sample_result: SolveResult) -> dict[str, Any]:
    """A college with the sample timetable published."""
    c = client.post("/colleges", json={"name": "Sample College"}).json()
    admin = {"X-Admin-Key": c["admin_key"]}
    body = {"data": sample_college().model_dump(mode="json"), "result": sample_result.model_dump(mode="json")}
    assert client.post(f"/colleges/{c['code']}/publish", json=body, headers=admin).status_code == 200
    return {**c, "admin": admin}


def request(c: dict[str, Any], **over: Any) -> Any:
    body = {
        "room_id": "SH-1", "date": MONDAY.isoformat(), "start_period": 3, "end_period": 4,
        "title": "Coding contest", "purpose": "Annual contest", "attendees": 120,
        "organiser": "Aman", "club": "Coding Club", "contact": "aman@example.com", **over,
    }
    return client.post(f"/colleges/{c['code']}/bookings", json=body)


def set_chain(c: dict[str, Any], *titles: str) -> list[dict[str, Any]]:
    res = client.put(f"/colleges/{c['code']}/approval-steps", json=[{"title": t} for t in titles], headers=c["admin"])
    assert res.status_code == 200
    return res.json()


def decide(c: dict[str, Any], booking_id: int, action: str, headers: dict[str, str], note: str = "") -> Any:
    return client.post(f"/colleges/{c['code']}/approvals/{booking_id}", json={"action": action, "note": note}, headers=headers)


def test_free_periods_and_overlap(college: dict[str, Any]) -> None:
    first = request(college)
    assert first.status_code == 201
    b = first.json()
    assert b["status"] == "pending" and b["waiting_for"] == "Dean" and b["room_name"] == "Seminar Hall"  # a club's request

    # The requested periods are no longer offered as free.
    slots = client.get(f"/colleges/{college['code']}/availability", params={"room_id": "SH-1", "date": MONDAY.isoformat()}).json()
    assert slots["day"] == "Monday"
    taken = {s["period"]: s["reason"] for s in slots["periods"] if not s["free"]}
    assert taken == {3: "requested", 4: "requested"}

    # Overlapping is refused; next to it, another day, or another hall is fine.
    res = request(college, start_period=4, end_period=5)
    assert res.status_code == 409
    assert "Period 4" in res.json()["detail"]
    assert request(college, start_period=5, end_period=6).status_code == 201
    assert request(college, date=(MONDAY + timedelta(days=1)).isoformat()).status_code == 201
    assert request(college, room_id="AUD").status_code == 201


def test_capacity_and_bad_requests(college: dict[str, Any]) -> None:
    res = request(college, attendees=151)
    assert res.status_code == 400
    assert "seats 150" in res.json()["detail"]
    assert request(college, room_id="AUD", attendees=600).status_code == 201
    # Unknown rooms, past dates and periods outside the day can't be booked.
    assert request(college, room_id="NOPE").status_code == 400
    assert request(college, date=(date.today() - timedelta(days=3)).isoformat()).status_code == 400
    assert request(college, start_period=6, end_period=8).status_code == 400
    assert request(college, start_period=5, end_period=4).status_code == 400


def member_key(c: dict[str, Any], path: str, body: dict[str, Any] | None = None) -> dict[str, str]:
    res = client.post(f"/colleges/{c['code']}/{path}", json=body, headers=c["admin"])
    assert res.status_code == 200, res.text
    return {"X-Member-Key": res.json()["key"]}


def test_a_teachers_request_goes_to_their_hod_then_the_dean(college: dict[str, Any]) -> None:
    code = college["code"]
    cse, ece = member_key(college, "departments/CSE/hod", {"name": "Dr. Head"}), member_key(college, "departments/ECE/hod", {})
    hk = member_key(college, "teachers/HK/link")  # HK teaches in CSE
    res = client.post(f"/colleges/{code}/bookings", headers=hk, json={
        "room_id": "SH-1", "date": MONDAY.isoformat(), "start_period": 3, "end_period": 4, "title": "Coding contest",
        "attendees": 120, "organiser": "Dr. Harpreet Kaur", "club": "CSE", "contact": "hk@example.com"})
    assert res.status_code == 201
    b = res.json()
    assert b["waiting_for"] == "HOD (CSE)" and [s["title"] for s in b["steps"]] == ["HOD (CSE)", "Dean"]

    # Only the CSE HOD acts at this step; the ECE HOD doesn't even see it.
    assert decide(college, b["id"], "approve", ece).status_code == 409
    assert client.get(f"/colleges/{code}/approvals", headers=ece).json()["bookings"] == []
    assert [x["id"] for x in client.get(f"/colleges/{code}/approvals", headers=cse).json()["bookings"]] == [b["id"]]

    b = decide(college, b["id"], "approve", cse, note="Fine by the department").json()
    assert b["status"] == "pending" and b["waiting_for"] == "Dean"
    assert decide(college, b["id"], "approve", cse).status_code == 409  # the HOD can't act twice
    b = decide(college, b["id"], "approve", college["admin"]).json()
    assert b["status"] == "approved"
    assert [h["by"] for h in b["history"]] == ["HOD (CSE) (Dr. Head)", "Dean"]
    assert b["history"][0]["note"] == "Fine by the department"

    # The teacher sees their own requests; the events calendar shows it without personal details.
    mine = client.get(f"/colleges/{code}/my-bookings", headers=hk).json()
    assert [x["id"] for x in mine] == [b["id"]]
    events = client.get(f"/colleges/{code}/events").json()
    assert [e["title"] for e in events] == ["Coding contest"]
    assert "contact" not in events[0] and "organiser" not in events[0]
    slots = client.get(f"/colleges/{code}/availability", params={"room_id": "SH-1", "date": MONDAY.isoformat()}).json()
    assert {s["period"] for s in slots["periods"] if s["reason"] == "booked"} == {3, 4}


def test_any_free_room_can_be_booked(college: dict[str, Any], sample_result: SolveResult) -> None:
    monday = [e for e in sample_result.entries if e.day == "Monday"]
    busy = {e.period for e in monday if e.room_id == "C-101"}
    free = next(p for p in range(1, 8) if p not in busy)
    ok = request(college, room_id="C-101", start_period=free, end_period=free, attendees=30)
    assert ok.status_code == 201 and ok.json()["waiting_for"] == "Dean"
    if busy:  # a period with a class is never offered
        res = request(college, room_id="C-101", start_period=min(busy), end_period=min(busy), attendees=30)
        assert res.status_code == 409 and "has a class" in res.json()["detail"]


def test_reject_and_cancel_free_the_slot(college: dict[str, Any]) -> None:
    b = request(college).json()
    r = decide(college, b["id"], "reject", college["admin"], note="Exams that week").json()
    assert r["status"] == "rejected"
    assert r["steps"][0]["state"] == "rejected"
    assert r["history"][0]["note"] == "Exams that week"
    assert decide(college, b["id"], "approve", college["admin"]).status_code == 409  # stays rejected

    again = request(college).json()  # the slot is free again
    tracked = client.post(f"/bookings/{again['token']}/cancel").json()
    assert tracked["status"] == "cancelled"
    assert request(college).status_code == 201
    assert client.get(f"/colleges/{college['code']}/events").json() == []


def test_approving_rechecks_clashes(college: dict[str, Any]) -> None:
    a = request(college).json()
    b = request(college, start_period=5, end_period=6).json()
    # Simulate a race that slipped past the request check: b now overlaps a.
    with next(db.get_session()) as s:
        row = s.get(db.Booking, b["id"])
        assert row is not None
        row.start_period = 4
        s.commit()
    assert decide(college, a["id"], "approve", college["admin"]).json()["status"] == "approved"
    res = decide(college, b["id"], "approve", college["admin"])
    assert res.status_code == 409
    assert "can't be approved" in res.json()["detail"]


def test_who_can_see_and_act(college: dict[str, Any]) -> None:
    b = request(college).json()
    code = college["code"]
    # Organisers, students and teachers can't list requests or decide.
    assert client.get(f"/colleges/{code}/approvals").status_code == 403
    assert client.get(f"/colleges/{code}/approvals", headers=member_key(college, "teachers/AS/link")).status_code == 403
    assert decide(college, b["id"], "approve", {"X-Approver-Key": "guess"}).status_code == 403
    assert client.put(f"/colleges/{code}/approval-steps", json=[{"title": "Me"}]).status_code == 403
    # The Dean sees everything, with the organiser's contact.
    view = client.get(f"/colleges/{code}/approvals", headers=college["admin"]).json()
    assert view["bookings"][0]["contact"] == "aman@example.com"

    # Old approver links (from before routes) still work and can be replaced.
    (hod,) = set_chain(college, "HOD")
    fresh = client.post(f"/colleges/{code}/approval-steps/{hod['id']}/new-link", headers=college["admin"]).json()
    assert client.get(f"/colleges/{code}/approvals", headers={"X-Approver-Key": hod["key"]}).status_code == 403
    assert client.get(f"/colleges/{code}/approvals", headers={"X-Approver-Key": fresh["key"]}).json()["you"]["title"] == "HOD"
    steps = set_chain_keep(college, [{"id": hod["id"], "title": "Head of Department"}, {"title": "Dean"}])
    assert steps[0]["key"] is None and steps[1]["key"]
    assert client.get("/bookings/not-a-token").status_code == 404


def set_chain_keep(c: dict[str, Any], steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    res = client.put(f"/colleges/{c['code']}/approval-steps", json=steps, headers=c["admin"])
    assert res.status_code == 200
    return res.json()


def test_booking_needs_a_published_timetable() -> None:
    c = client.post("/colleges", json={"name": "New College"}).json()
    res = client.post(
        f"/colleges/{c['code']}/bookings",
        json={"room_id": "SH-1", "date": MONDAY.isoformat(), "start_period": 1, "end_period": 1, "title": "x",
              "attendees": 1, "organiser": "a", "club": "b", "contact": "123"},
    )
    assert res.status_code == 409
    assert "hasn't published" in res.json()["detail"]
