"""P7 meets the daily features: a short day has fewer periods everywhere, and
cover for one lab batch never touches the other batch's class."""

from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import ask, db
from app.changes import Day, actual
from app.db import DayChange
from app.main import app
from assistant.tools import free_rooms, teacher_free_slots
from solver import CollegeData, SolveResult, sample_college
from solver.models import Entry

client = TestClient(app)
MONDAY = date.today() + timedelta(days=7 + (7 - date.today().weekday()) % 7)
SATURDAY = MONDAY + timedelta(days=5)


@pytest.fixture(autouse=True)
def fresh(tmp_path: Path) -> Iterator[None]:
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    yield


@pytest.fixture
def college(sample_result: SolveResult) -> dict[str, Any]:
    """The sample, with a 4-period Saturday added (no classes on it in this timetable)."""
    data = sample_college().model_dump(mode="json")
    data["settings"]["days"] = [*data["settings"]["days"], "Saturday"]
    data["settings"]["periods_by_day"] = {"Saturday": 4}
    CollegeData.model_validate(data)
    c = client.post("/colleges", json={"name": "Short Saturday College"}).json()
    admin = {"X-Admin-Key": c["admin_key"]}
    res = client.post(f"/colleges/{c['code']}/publish", json={"data": data, "result": sample_result.model_dump(mode="json")}, headers=admin)
    assert res.status_code == 200, res.text
    return {**c, "admin": admin}


def test_a_short_day_has_fewer_periods_everywhere(college: dict[str, Any]) -> None:
    code, admin, sat = college["code"], college["admin"], SATURDAY.isoformat()

    # Hall booking: only 4 periods to choose from, and period 5 can't be asked for.
    slots = client.get(f"/colleges/{code}/availability", params={"room_id": "SH-1", "date": sat}).json()
    assert [s["period"] for s in slots["periods"]] == [1, 2, 3, 4]
    late = client.post(f"/colleges/{code}/bookings", json={
        "room_id": "SH-1", "date": sat, "start_period": 4, "end_period": 5, "title": "x", "attendees": 10,
        "organiser": "a", "club": "b", "contact": "123"})
    assert late.status_code == 400 and "between 1 and 4" in late.json()["detail"]

    # Whole-day leave ends at period 4; extra classes offer 4 periods.
    lv = client.post(f"/colleges/{code}/leaves", json={"teacher_id": "HK", "date": sat}, headers=admin).json()
    assert (lv["start_period"], lv["end_period"]) == (1, 4)
    extra = client.get(f"/colleges/{code}/extra-slots", params={"date": sat, "section_id": "CSE-3A", "teacher_id": "AS"}, headers=admin).json()
    assert [o["period"] for o in extra] == [1, 2, 3, 4]

    # The helper knows it too.
    with next(db.get_session()) as session:
        ctx = ask.build_context(session, ask.find_college(session, code), ask.AskIn(question="x", now=f"{MONDAY.isoformat()}T09:00"))
    assert "There is no period 5" in free_rooms(ctx, "Saturday", 5)
    assert "Periods run 1 to 4" in free_rooms(ctx, "Saturday", 6)
    sat_free = teacher_free_slots(ctx, "AS", "Saturday")
    assert "P4 " in sat_free and "P5 " not in sat_free


def test_cover_for_one_batch_leaves_the_other_alone() -> None:
    """CSE-3A's two lab batches share periods 5–6 with different teachers; HK (batch A1) is away."""
    data = sample_college()
    lab = dict(day="Monday", section_id="CSE-3A", subject_id="CS201", kind="lab")
    base = [
        Entry(**lab, period=5, teacher_id="HK", room_id="LAB-1", batch="A1"),
        Entry(**lab, period=6, teacher_id="HK", room_id="LAB-1", batch="A1"),
        Entry(**lab, period=5, teacher_id="AS", room_id="LAB-2", batch="A2"),
        Entry(**lab, period=6, teacher_id="AS", room_id="LAB-2", batch="A2"),
    ]

    def day(*changes: DayChange) -> list[Entry]:
        return actual(Day(college=None, data=data, base=base, date=MONDAY, day="Monday", working=True,  # type: ignore[arg-type]
                          changes=list(changes), leaves=[]))

    common = dict(date=MONDAY.isoformat(), section_id="CSE-3A", subject_id="CS201", start_period=5, end_period=6,
                  room_id="LAB-1", class_kind="lab", teacher_id="HK")
    sub = day(DayChange(kind="substitute", new_teacher_id="NS", **common))
    assert sorted((e.batch, e.teacher_id) for e in sub) == [("A1", "NS"), ("A1", "NS"), ("A2", "AS"), ("A2", "AS")]
    cancelled = day(DayChange(kind="cancel", **common))
    assert {(e.batch, e.teacher_id) for e in cancelled} == {("A2", "AS")}
