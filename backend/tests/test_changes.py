from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from solver import CollegeData, SolveResult, sample_college
from solver.models import Slot

client = TestClient(app)

MONDAY = date.today() + timedelta(days=7 + (7 - date.today().weekday()) % 7)
SATURDAY = MONDAY + timedelta(days=5)  # not a working day in the sample


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path) -> Iterator[None]:
    db.configure(f"sqlite:///{tmp_path / 'test.db'}")
    yield


def publish(result: SolveResult, data: CollegeData | None = None) -> dict[str, Any]:
    c = client.post("/colleges", json={"name": "Sample College"}).json()
    admin = {"X-Admin-Key": c["admin_key"]}
    body = {"data": (data or sample_college()).model_dump(mode="json"), "result": result.model_dump(mode="json")}
    assert client.post(f"/colleges/{c['code']}/publish", json=body, headers=admin).status_code == 200
    return {**c, "admin": admin}


@pytest.fixture
def college(sample_result: SolveResult) -> dict[str, Any]:
    return publish(sample_result)


def day(c: dict[str, Any], d: date = MONDAY) -> dict[str, Any]:
    res = client.get(f"/colleges/{c['code']}/day", params={"date": d.isoformat()})
    assert res.status_code == 200
    return res.json()


def cover(c: dict[str, Any], d: date = MONDAY) -> dict[str, Any]:
    res = client.get(f"/colleges/{c['code']}/cover", params={"date": d.isoformat()}, headers=c["admin"])
    assert res.status_code == 200
    return res.json()


def leave(c: dict[str, Any], teacher: str, d: date = MONDAY, admin: bool = False, **periods: int) -> Any:
    return client.post(f"/colleges/{c['code']}/leaves", json={"teacher_id": teacher, "date": d.isoformat(), **periods},
                       headers=c["admin"] if admin else {})


def change(c: dict[str, Any], **body: Any) -> Any:
    return client.post(f"/colleges/{c['code']}/changes", json={"date": MONDAY.isoformat(), **body}, headers=c["admin"])


def busy(entries: list[dict[str, Any]], teacher: str, periods: range) -> bool:
    return any(e["teacher_id"] == teacher and e["period"] in periods for e in entries)


def test_leave_lists_classes_with_ranked_substitutes(college: dict[str, Any]) -> None:
    before = day(college)["entries"]
    hk = sorted({e["period"] for e in before if e["teacher_id"] == "HK"})
    assert hk, "HK teaches on Monday in the sample"

    lv = leave(college, "HK", reason="Fever")
    assert lv.status_code == 201
    assert lv.json()["by"] == "teacher" and (lv.json()["start_period"], lv.json()["end_period"]) == (1, 7)

    (info,) = cover(college)["leaves"]
    assert sorted(p for c in info["classes"] for p in range(c["start_period"], c["end_period"] + 1)) == hk
    tiers = {"subject": 0, "department": 1, "anyone": 2}
    for cls in info["classes"]:
        assert cls["state"] == "needs_cover"
        periods = range(cls["start_period"], cls["end_period"] + 1)
        ranks = [tiers[s["tier"]] for s in cls["suggestions"]]
        assert ranks == sorted(ranks)  # same subject, then same department, then anyone
        for s in cls["suggestions"]:
            assert s["teacher_id"] != "HK"
            assert not busy(before, s["teacher_id"], periods)  # free that period

    # Leave alone changes nothing for students until the admin acts.
    assert day(college)["entries"] == before
    assert day(college)["check"]["ok"] is True


def test_substitute_and_cancel_change_the_day(college: dict[str, Any]) -> None:
    leave(college, "HK", admin=True)
    (info,) = cover(college)["leaves"]
    first, *rest = info["classes"]
    sub = first["suggestions"][0]["teacher_id"]
    periods = range(first["start_period"], first["end_period"] + 1)

    res = change(college, kind="substitute", section_id=first["section_id"], start_period=first["start_period"],
                 end_period=first["end_period"], new_teacher_id=sub, leave_id=info["id"])
    assert res.status_code == 201
    d = day(college)
    moved = [e for e in d["entries"] if e["section_id"] == first["section_id"] and e["period"] in periods]
    assert moved and all(e["teacher_id"] == sub for e in moved)
    assert d["check"]["ok"] is True and d["check"]["clashes"] == []
    assert cover(college)["leaves"][0]["classes"][0]["state"] == "substitute"

    # Changing your mind replaces the substitute instead of stacking.
    other = next(s["teacher_id"] for s in first["suggestions"] if s["teacher_id"] != sub)
    assert change(college, kind="substitute", section_id=first["section_id"], start_period=first["start_period"],
                  end_period=first["end_period"], new_teacher_id=other).status_code == 201
    assert [c["new_teacher_id"] for c in day(college)["changes"]] == [other]

    # Cancel another class: it disappears from the day; undo brings it back.
    if rest:
        nxt = rest[0]
        res = change(college, kind="cancel", section_id=nxt["section_id"], start_period=nxt["start_period"], end_period=nxt["end_period"])
        assert res.status_code == 201
        gone = range(nxt["start_period"], nxt["end_period"] + 1)
        assert not any(e["section_id"] == nxt["section_id"] and e["period"] in gone for e in day(college)["entries"])
        assert client.delete(f"/colleges/{college['code']}/changes/{res.json()['id']}", headers=college["admin"]).status_code == 204
        assert any(e["section_id"] == nxt["section_id"] and e["period"] in gone for e in day(college)["entries"])


def test_substitute_must_be_free_and_not_the_same_teacher(college: dict[str, Any]) -> None:
    entries = day(college)["entries"]
    target = next(e for e in entries if e["teacher_id"] == "HK" and e["kind"] == "lecture")
    p = target["period"]
    clash = next(e["teacher_id"] for e in entries if e["period"] == p and e["teacher_id"] != "HK")
    res = change(college, kind="substitute", section_id=target["section_id"], start_period=p, new_teacher_id=clash)
    assert res.status_code == 409
    assert "would break the timetable" in res.json()["detail"]
    assert change(college, kind="substitute", section_id=target["section_id"], start_period=p, new_teacher_id="HK").status_code == 400
    # A period with no class for the section can't be covered or cancelled.
    free = next(q for q in range(1, 8) if not any(e["section_id"] == target["section_id"] and e["period"] == q for e in entries))
    assert change(college, kind="cancel", section_id=target["section_id"], start_period=free).status_code == 400


def test_unavailable_over_max_or_on_leave_are_never_suggested(sample_result: SolveResult) -> None:
    data = sample_college()
    monday = [e for e in sample_result.entries if e.day == "Monday"]
    target = next(e for e in monday if e.teacher_id == "HK" and e.kind == "lecture")
    p = target.period
    free = [t.id for t in data.teachers if t.id != "HK" and not any(e.teacher_id == t.id and e.period == p for e in monday)]
    away, maxed, on_leave_too = free[0], free[1], free[2]
    teachers = {t.id: t for t in data.teachers}
    teachers[away].unavailable.append(Slot(day="Monday", period=p))
    teachers[maxed].max_periods_per_day = max(1, sum(1 for e in monday if e.teacher_id == maxed))
    data = CollegeData.model_validate(data.model_dump())
    c = publish(sample_result, data)

    leave(c, "HK", admin=True, start_period=p, end_period=p)
    leave(c, on_leave_too, admin=True, start_period=p, end_period=p)
    cls = cover(c)["leaves"][0]["classes"][0]
    names = {s["teacher_id"] for s in cls["suggestions"]}
    assert away not in names and maxed not in names and on_leave_too not in names
    assert names  # someone else is still free

    for who, why in ((away, "unavailable"), (maxed, "daily maximum"), (on_leave_too, "on leave")):
        res = change(c, kind="substitute", section_id=target.section_id, start_period=p, new_teacher_id=who)
        assert res.status_code == 409, who
        assert why in res.json()["detail"], res.json()["detail"]


def test_extra_class_slots_and_booking(college: dict[str, Any]) -> None:
    def slots(d: date = MONDAY) -> list[dict[str, Any]]:
        res = client.get(f"/colleges/{college['code']}/extra-slots",
                         params={"date": d.isoformat(), "section_id": "CSE-3A", "teacher_id": "HK"}, headers=college["admin"])
        assert res.status_code == 200
        return res.json()

    entries = day(college)["entries"]
    options = slots()
    for o in options:
        clash = any(e["period"] == o["period"] and (e["section_id"] == "CSE-3A" or e["teacher_id"] == "HK") for e in entries)
        assert o["ok"] is not clash
        if o["ok"]:
            used = {e["room_id"] for e in entries if e["period"] == o["period"]}
            assert o["rooms"] and not set(o["rooms"]) & used
    ok = next(o for o in options if o["ok"])
    res = change(college, kind="extra", section_id="CSE-3A", subject_id="CS201", start_period=ok["period"], room_id=ok["rooms"][0], note="Makeup")
    assert res.status_code == 201
    d = day(college)
    assert any(e["period"] == ok["period"] and e["section_id"] == "CSE-3A" and e["teacher_id"] == "HK" for e in d["entries"])
    assert d["check"]["ok"] is True
    assert next(o for o in slots() if o["period"] == ok["period"])["ok"] is False

    # Into a period where the section already has a class: refused by the clash check.
    taken = next(o for o in options if not o["ok"])
    room = ok["rooms"][0]  # a suitable room; the section clash is what stops it
    assert change(college, kind="extra", section_id="CSE-3A", subject_id="CS201", start_period=taken["period"], room_id=room).status_code == 409
    # A subject the section doesn't study is refused.
    assert change(college, kind="extra", section_id="CSE-3A", subject_id="EC201", start_period=ok["period"], room_id=room).status_code == 400

    # A makeup class on Saturday (not a working day) is fine.
    sat = slots(SATURDAY)
    assert all(o["ok"] for o in sat)
    res = client.post(f"/colleges/{college['code']}/changes", headers=college["admin"], json={
        "date": SATURDAY.isoformat(), "kind": "extra", "section_id": "CSE-3A", "subject_id": "CS201",
        "start_period": 1, "end_period": 2, "room_id": sat[0]["rooms"][0],
    })
    assert res.status_code == 201
    s = day(college, SATURDAY)
    assert s["working_day"] is False and s["day"] == "Saturday"
    assert len(s["entries"]) == 2 and s["check"]["ok"] is True


def test_only_the_admin_changes_the_day(college: dict[str, Any]) -> None:
    code = college["code"]
    body = {"date": MONDAY.isoformat(), "kind": "cancel", "section_id": "CSE-3A", "start_period": 1}
    assert client.post(f"/colleges/{code}/changes", json=body).status_code == 403
    assert client.get(f"/colleges/{code}/cover", params={"date": MONDAY.isoformat()}).status_code == 403
    assert client.get(f"/colleges/{code}/extra-slots", params={"date": MONDAY.isoformat(), "section_id": "CSE-3A", "teacher_id": "HK"}).status_code == 403

    # Removing a leave removes the cover arranged for it.
    lv = leave(college, "HK").json()
    cls = cover(college)["leaves"][0]["classes"][0]
    change(college, kind="cancel", section_id=cls["section_id"], start_period=cls["start_period"], end_period=cls["end_period"], leave_id=lv["id"])
    assert len(day(college)["changes"]) == 1
    assert client.delete(f"/colleges/{code}/leaves/{lv['id']}").status_code == 403
    assert client.delete(f"/colleges/{code}/leaves/{lv['id']}", headers=college["admin"]).status_code == 204
    assert day(college)["changes"] == []


def test_leave_rules_and_changes_range(college: dict[str, Any]) -> None:
    assert leave(college, "NOPE").status_code == 400
    assert leave(college, "HK", d=date.today() - timedelta(days=5)).status_code == 400
    assert leave(college, "HK", start_period=3, end_period=2).status_code == 400
    assert leave(college, "HK", start_period=2, end_period=3).status_code == 201
    assert leave(college, "HK", start_period=3, end_period=4).status_code == 409  # overlaps

    code = college["code"]
    entries = day(college)["entries"]
    e = next(x for x in entries if x["kind"] == "lecture")
    change(college, kind="cancel", section_id=e["section_id"], start_period=e["period"])
    got = client.get(f"/colleges/{code}/changes", params={"from": MONDAY.isoformat(), "to": (MONDAY + timedelta(days=6)).isoformat()}).json()
    assert [(g["kind"], g["section_id"], g["start_period"]) for g in got] == [("cancel", e["section_id"], e["period"])]
    assert client.get(f"/colleges/{code}/changes", params={"from": MONDAY.isoformat(), "to": (MONDAY + timedelta(days=40)).isoformat()}).status_code == 400
