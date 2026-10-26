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
    assert b["status"] == "pending" and b["waiting_for"] == "Admin" and b["room_name"] == "Seminar Hall"

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
    # Classrooms and labs can't be booked; nor can past dates or periods outside the day.
    assert request(college, room_id="C-101").status_code == 400
    assert request(college, date=(date.today() - timedelta(days=3)).isoformat()).status_code == 400
    assert request(college, start_period=6, end_period=8).status_code == 400
    assert request(college, start_period=5, end_period=4).status_code == 400


def test_chain_goes_in_order(college: dict[str, Any]) -> None:
    hod, dean = set_chain(college, "HOD", "Dean")
    assert hod["key"] and dean["key"]
    as_hod, as_dean = {"X-Approver-Key": hod["key"]}, {"X-Approver-Key": dean["key"]}
    b = request(college).json()
    assert b["waiting_for"] == "HOD"
    assert [s["state"] for s in b["steps"]] == ["waiting", "later"]

    # The Dean can't approve before the HOD.
    res = decide(college, b["id"], "approve", as_dean)
    assert res.status_code == 409
    assert "waiting for HOD" in res.json()["detail"]

    b = decide(college, b["id"], "approve", as_hod, note="Fine by the department").json()
    assert b["status"] == "pending" and b["waiting_for"] == "Dean"
    assert [s["state"] for s in b["steps"]] == ["approved", "waiting"]

    # Now the HOD's link can't act again; the Dean's can.
    assert decide(college, b["id"], "approve", as_hod).status_code == 409
    b = decide(college, b["id"], "approve", as_dean).json()
    assert b["status"] == "approved" and b["waiting_for"] is None
    assert [h["step_title"] for h in b["history"]] == ["HOD", "Dean"]
    assert b["history"][0]["note"] == "Fine by the department"

    # Approved: on the events calendar, and its periods show as booked.
    events = client.get(f"/colleges/{college['code']}/events").json()
    assert [e["title"] for e in events] == ["Coding contest"]
    assert "contact" not in events[0] and "organiser" not in events[0]
    slots = client.get(f"/colleges/{college['code']}/availability", params={"room_id": "SH-1", "date": MONDAY.isoformat()}).json()
    assert {s["period"] for s in slots["periods"] if s["reason"] == "booked"} == {3, 4}


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
    # Organisers and the public can't list requests or decide.
    assert client.get(f"/colleges/{code}/approvals").status_code == 403
    assert decide(college, b["id"], "approve", {"X-Approver-Key": "guess"}).status_code == 403
    assert client.put(f"/colleges/{code}/approval-steps", json=[{"title": "Me"}]).status_code == 403

    # A new link replaces the old one.
    (hod,) = set_chain(college, "HOD")
    fresh = client.post(f"/colleges/{code}/approval-steps/{hod['id']}/new-link", headers=college["admin"]).json()
    assert client.get(f"/colleges/{code}/approvals", headers={"X-Approver-Key": hod["key"]}).status_code == 403
    view = client.get(f"/colleges/{code}/approvals", headers={"X-Approver-Key": fresh["key"]}).json()
    assert view["you"]["title"] == "HOD"
    assert [x["id"] for x in view["bookings"]] == [b["id"]]
    assert view["bookings"][0]["contact"] == "aman@example.com"  # approvers may contact the organiser

    # Keeping a step by id keeps its link; the tracking link shows the request to anyone holding it.
    steps = set_chain_keep(college, [{"id": hod["id"], "title": "Head of Department"}, {"title": "Dean"}])
    assert steps[0]["key"] is None and steps[1]["key"]
    assert client.get(f"/colleges/{code}/approvals", headers={"X-Approver-Key": fresh["key"]}).status_code == 200
    assert client.get(f"/bookings/{b['token']}").json()["waiting_for"] == "Head of Department"
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
