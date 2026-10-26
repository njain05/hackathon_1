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


def teacher_key(c: dict[str, Any], teacher: str) -> dict[str, str]:
    res = client.post(f"/colleges/{c['code']}/teachers/{teacher}/link", headers=c["admin"])
    assert res.status_code == 200
    return {"X-Member-Key": res.json()["key"]}


def hod_key(c: dict[str, Any], dept: str, name: str = "") -> dict[str, str]:
    res = client.post(f"/colleges/{c['code']}/departments/{dept}/hod", json={"name": name}, headers=c["admin"])
    assert res.status_code == 200
    return {"X-Member-Key": res.json()["key"]}


def leave(c: dict[str, Any], teacher: str, d: date = MONDAY, admin: bool = False, **periods: int) -> Any:
    """Admin-added leave is approved at once; otherwise the teacher asks with their own link."""
    headers = c["admin"] if admin else teacher_key(c, teacher)
    return client.post(f"/colleges/{c['code']}/leaves", json={"teacher_id": teacher, "date": d.isoformat(), **periods}, headers=headers)


def decide(c: dict[str, Any], leave_id: int, action: str, headers: dict[str, str], note: str = "") -> Any:
    return client.post(f"/colleges/{c['code']}/leaves/{leave_id}/decide", json={"action": action, "note": note}, headers=headers)


def change(c: dict[str, Any], **body: Any) -> Any:
    return client.post(f"/colleges/{c['code']}/changes", json={"date": MONDAY.isoformat(), **body}, headers=c["admin"])


def busy(entries: list[dict[str, Any]], teacher: str, periods: range) -> bool:
    return any(e["teacher_id"] == teacher and e["period"] in periods for e in entries)


def test_leave_lists_classes_with_ranked_substitutes(college: dict[str, Any]) -> None:
    before = day(college)["entries"]
    hk = sorted({e["period"] for e in before if e["teacher_id"] == "HK"})
    assert hk, "HK teaches on Monday in the sample"

    hod = hod_key(college, "CSE", "Dr. Head")
    lv = leave(college, "HK", reason="Fever")
    assert lv.status_code == 201
    body = lv.json()
    assert body["by"] == "teacher" and (body["start_period"], body["end_period"]) == (1, 7)
    assert body["status"] == "pending" and body["waiting_for"] == "HOD (CSE)"

    # Waiting for the HOD: the classes show, but no cover is offered yet.
    (info,) = cover(college)["leaves"]
    assert info["status"] == "pending"
    assert all(c["state"] == "awaiting_approval" and c["suggestions"] == [] for c in info["classes"])
    assert decide(college, body["id"], "approve", hod, note="Get well soon").json()["status"] == "approved"

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

    # Leave alone changes nothing for students until the HOD or Dean acts.
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
        # Cancelling takes the whole class (a lab's whole block, even when it's covered hour by hour).
        res = change(college, kind="cancel", section_id=nxt["section_id"], start_period=nxt["block_start"], end_period=nxt["block_end"])
        assert res.status_code == 201
        gone = range(nxt["block_start"], nxt["block_end"] + 1)
        assert not any(e["section_id"] == nxt["section_id"] and e["period"] in gone for e in day(college)["entries"])
        assert client.delete(f"/colleges/{college['code']}/changes/{res.json()['id']}", headers=college["admin"]).status_code == 204
        assert any(e["section_id"] == nxt["section_id"] and e["period"] in gone for e in day(college)["entries"])


def test_substitute_must_be_free_and_not_the_same_teacher(college: dict[str, Any]) -> None:
    # The solver may place classes differently run to run: find a weekday that has what this test needs.
    for i in range(5):
        when = MONDAY + timedelta(days=i)
        entries = day(college, when)["entries"]
        target = next((e for e in entries if e["teacher_id"] == "HK" and e["kind"] == "lecture"), None)
        if target is None:
            continue
        sec = target["section_id"]
        free = next((q for q in range(1, 8) if not any(e["section_id"] == sec and e["period"] == q for e in entries)), None)
        clash = next((e["teacher_id"] for e in entries if e["period"] == target["period"] and e["teacher_id"] != "HK"), None)
        if free and clash:
            break
    else:
        pytest.skip("no suitable weekday in this solve")
    p = target["period"]
    on = when.isoformat()
    res = change(college, kind="substitute", date=on, section_id=sec, start_period=p, new_teacher_id=clash)
    assert res.status_code == 409
    assert "would break the timetable" in res.json()["detail"]
    assert change(college, kind="substitute", date=on, section_id=sec, start_period=p, new_teacher_id="HK").status_code == 400
    # A period with no class for the section can't be covered or cancelled.
    assert change(college, kind="cancel", date=on, section_id=sec, start_period=free).status_code == 400


def test_unavailable_over_max_or_on_leave_are_never_suggested(sample_result: SolveResult) -> None:
    data = sample_college()
    daily = lambda t, d: sum(1 for e in sample_result.entries if e.teacher_id == t and e.day == d)  # noqa: E731
    busiest = {t.id: max(daily(t.id, d) for d in data.settings.days) for t in data.teachers}
    # Find a weekday where HK lectures and three other teachers are free then, one of them at their busiest.
    for i, dname in enumerate(data.settings.days):
        today_ = [e for e in sample_result.entries if e.day == dname]
        target = next((e for e in today_ if e.teacher_id == "HK" and e.kind == "lecture"), None)
        if target is None:
            continue
        p = target.period
        free = [t.id for t in data.teachers if t.id != "HK" and not any(e.teacher_id == t.id and e.period == p for e in today_)]
        maxed = next((t for t in free if busiest[t] >= 1 and daily(t, dname) == busiest[t]), None)
        others = [t for t in free if t != maxed]
        if maxed and len(others) >= 3:
            break
    else:
        pytest.skip("no suitable weekday in this solve")
    when = MONDAY + timedelta(days=i)
    away, on_leave_too = others[0], others[1]
    teachers = {t.id: t for t in data.teachers}
    teachers[away].unavailable.append(Slot(day=dname, period=p))
    teachers[maxed].max_periods_per_day = busiest[maxed]  # already at their maximum that day
    data = CollegeData.model_validate(data.model_dump())
    c = publish(sample_result, data)

    leave(c, "HK", d=when, admin=True, start_period=p, end_period=p)
    leave(c, on_leave_too, d=when, admin=True, start_period=p, end_period=p)
    cls = next(lv for lv in cover(c, when)["leaves"] if lv["teacher_id"] == "HK")["classes"][0]
    names = {s["teacher_id"] for s in cls["suggestions"]}
    assert away not in names and maxed not in names and on_leave_too not in names
    assert names  # someone else is still free

    for who, why in ((away, "unavailable"), (maxed, "daily maximum"), (on_leave_too, "on leave")):
        res = change(c, kind="substitute", date=when.isoformat(), section_id=target.section_id, start_period=p, new_teacher_id=who)
        assert res.status_code == 409, who
        assert why in res.json()["detail"], res.json()["detail"]


def test_extra_class_slots_and_booking(college: dict[str, Any]) -> None:
    def slots(d: date = MONDAY) -> list[dict[str, Any]]:
        res = client.get(f"/colleges/{college['code']}/extra-slots",
                         params={"date": d.isoformat(), "section_id": "CSE-3A", "teacher_id": "HK"}, headers=college["admin"])
        assert res.status_code == 200
        return res.json()

    # The solver may place classes differently run to run: use a weekday with a free common period.
    when = next(MONDAY + timedelta(days=i) for i in range(5) if any(o["ok"] for o in slots(MONDAY + timedelta(days=i))))
    entries = day(college, when)["entries"]
    options = slots(when)
    for o in options:
        clash = any(e["period"] == o["period"] and (e["section_id"] == "CSE-3A" or e["teacher_id"] == "HK") for e in entries)
        assert o["ok"] is not clash
        if o["ok"]:
            used = {e["room_id"] for e in entries if e["period"] == o["period"]}
            assert o["rooms"] and not set(o["rooms"]) & used
    ok = next(o for o in options if o["ok"])
    res = change(college, kind="extra", date=when.isoformat(), section_id="CSE-3A", subject_id="CS201",
                 start_period=ok["period"], room_id=ok["rooms"][0], note="Makeup")
    assert res.status_code == 201
    d = day(college, when)
    assert any(e["period"] == ok["period"] and e["section_id"] == "CSE-3A" and e["teacher_id"] == "HK" for e in d["entries"])
    assert d["check"]["ok"] is True
    assert next(o for o in slots(when) if o["period"] == ok["period"])["ok"] is False

    # Into a period where the section already has a class: refused by the clash check.
    taken = next(o for o in options if not o["ok"])
    room = ok["rooms"][0]  # a suitable room; the section clash is what stops it
    assert change(college, kind="extra", date=when.isoformat(), section_id="CSE-3A", subject_id="CS201",
                  start_period=taken["period"], room_id=room).status_code == 409
    # A subject the section doesn't study is refused.
    assert change(college, kind="extra", date=when.isoformat(), section_id="CSE-3A", subject_id="EC201",
                  start_period=ok["period"], room_id=room).status_code == 400

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


def test_only_the_dean_or_the_classs_hod_changes_the_day(college: dict[str, Any]) -> None:
    code = college["code"]
    body = {"date": MONDAY.isoformat(), "kind": "cancel", "section_id": "CSE-3A", "start_period": 1}
    teacher = teacher_key(college, "AS")
    for headers in ({}, teacher):  # students and teachers can't
        assert client.post(f"/colleges/{code}/changes", json=body, headers=headers).status_code == 403
        assert client.get(f"/colleges/{code}/cover", params={"date": MONDAY.isoformat()}, headers=headers).status_code == 403
        assert client.get(f"/colleges/{code}/extra-slots", headers=headers,
                          params={"date": MONDAY.isoformat(), "section_id": "CSE-3A", "teacher_id": "HK"}).status_code == 403

    # HK (CSE) is away. The CSE HOD sees and covers CSE classes; the ECE HOD sees nothing of it and can't touch CSE.
    cse, ece = hod_key(college, "CSE"), hod_key(college, "ECE")
    lv = leave(college, "HK", admin=True).json()
    as_cse = client.get(f"/colleges/{code}/cover", params={"date": MONDAY.isoformat()}, headers=cse).json()
    classes = as_cse["leaves"][0]["classes"]
    assert classes and all(c["section_id"].startswith("CSE") for c in classes)
    assert client.get(f"/colleges/{code}/cover", params={"date": MONDAY.isoformat()}, headers=ece).json()["leaves"] == []
    cls = classes[0]
    whole = {"date": MONDAY.isoformat(), "kind": "cancel", "section_id": cls["section_id"], "start_period": cls["block_start"],
             "end_period": cls["block_end"], "teacher_id": "HK", "leave_id": lv["id"]}
    assert client.post(f"/colleges/{code}/changes", json=whole, headers=ece).status_code == 403
    made = client.post(f"/colleges/{code}/changes", json=whole, headers=cse)
    assert made.status_code == 201
    assert client.delete(f"/colleges/{code}/changes/{made.json()['id']}", headers=ece).status_code == 403
    assert len(day(college)["changes"]) == 1

    # Removing a leave (the Dean) removes the cover arranged for it.
    assert client.delete(f"/colleges/{code}/leaves/{lv['id']}").status_code == 403
    assert client.delete(f"/colleges/{code}/leaves/{lv['id']}", headers=college["admin"]).status_code == 204
    assert day(college)["changes"] == []


def test_lab_cover_per_period_or_whole_and_fair_ranking(college: dict[str, Any], sample_result: SolveResult) -> None:
    code = college["code"]
    # Find a weekday where some teacher has a 2-period lab.
    for i, dname in enumerate(sample_college().settings.days):
        labs = [e for e in sample_result.entries if e.day == dname and e.kind == "lab"]
        if labs:
            break
    when = MONDAY + timedelta(days=i)
    t = labs[0].teacher_id
    leave(college, t, d=when, admin=True)

    def lab_rows() -> list[dict[str, Any]]:
        info = next(lv for lv in cover(college, when)["leaves"] if lv["teacher_id"] == t)
        return [c for c in info["classes"] if c["class_kind"] == "lab" and c["section_id"] == labs[0].section_id]

    # Default: per period, each lab hour its own row with its own ranked substitutes.
    rows = lab_rows()
    assert len(rows) >= 2 and all(r["start_period"] == r["end_period"] for r in rows)
    assert all(r["block_end"] > r["block_start"] for r in rows)
    first, second = rows[0], rows[1]
    a = first["suggestions"][0]["teacher_id"]
    assert change(college, date=when.isoformat(), kind="substitute", section_id=first["section_id"],
                  start_period=first["start_period"], new_teacher_id=a, teacher_id=t).status_code == 201
    # Fairness: the teacher who just covered drops below equals for the next hour.
    nxt = next(r for r in lab_rows() if r["start_period"] == second["start_period"])
    ranks = [s["teacher_id"] for s in nxt["suggestions"]]
    peers = [s for s in nxt["suggestions"] if s["tier"] == first["suggestions"][0]["tier"]
             and s["load_today"] == first["suggestions"][0]["load_today"]]
    if a in ranks and len(peers) > 1:
        assert next(s for s in nxt["suggestions"] if s["teacher_id"] == a)["covers_week"] == 1
        assert peers[0]["teacher_id"] != a

    # The Dean switches the college to whole-lab cover: one row for the whole lab.
    assert client.put(f"/colleges/{code}/rules", json={"lab_cover": "whole"}, headers=teacher_key(college, "AS")).status_code == 403
    assert client.put(f"/colleges/{code}/rules", json={"lab_cover": "whole"}, headers=college["admin"]).json() == {"lab_cover": "whole"}
    whole = lab_rows()
    assert len(whole) == 1 and whole[0]["end_period"] > whole[0]["start_period"]


def test_leave_rules_and_changes_range(college: dict[str, Any]) -> None:
    assert leave(college, "NOPE", admin=True).status_code == 400
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


def test_only_a_teacher_with_their_link_can_ask_for_leave(college: dict[str, Any]) -> None:
    code = college["code"]
    body = {"teacher_id": "HK", "date": MONDAY.isoformat()}
    # A student (no link) can't, and another teacher can't ask for HK.
    assert client.post(f"/colleges/{code}/leaves", json=body).status_code == 403
    assert client.post(f"/colleges/{code}/leaves", json=body, headers={"X-Member-Key": "guess"}).status_code == 403
    res = client.post(f"/colleges/{code}/leaves", json=body, headers=teacher_key(college, "AS"))
    assert res.status_code == 403 and "your own leave" in res.json()["detail"]
    # An HOD link isn't a teacher link.
    assert client.post(f"/colleges/{code}/leaves", json=body, headers=hod_key(college, "CSE")).status_code == 403

    hk = teacher_key(college, "HK")
    res = client.post(f"/colleges/{code}/leaves", json={"date": MONDAY.isoformat(), "reason": "Conference"}, headers=hk)
    assert res.status_code == 201 and res.json()["teacher_id"] == "HK"
    me = client.get(f"/colleges/{code}/me", headers=hk).json()
    assert me["role"] == "teacher" and me["teacher_id"] == "HK" and me["department_id"] == "CSE"
    mine = client.get(f"/colleges/{code}/my-leaves", headers=hk).json()
    assert [x["reason"] for x in mine] == ["Conference"]
    assert client.get(f"/colleges/{code}/my-leaves").status_code == 403

    # A new link replaces the old one.
    teacher_key(college, "HK")
    assert client.get(f"/colleges/{code}/me", headers=hk).status_code == 403


def test_hod_decides_only_their_department(college: dict[str, Any]) -> None:
    code = college["code"]
    cse, ece = hod_key(college, "CSE", "Dr. Head"), hod_key(college, "ECE")
    hk = leave(college, "HK").json()  # HK is in CSE
    bs = leave(college, "BS").json()  # BS is in ECE

    view = client.get(f"/colleges/{code}/hod", headers=cse).json()
    assert view["department_id"] == "CSE" and [x["teacher_id"] for x in view["leaves"]] == ["HK"]
    assert decide(college, hk["id"], "approve", ece).status_code == 403
    assert decide(college, hk["id"], "approve", teacher_key(college, "AS")).status_code == 403
    assert decide(college, hk["id"], "approve", {}).status_code == 403

    # Cover can't be arranged before approval.
    cls = cover(college)["leaves"][0]["classes"][0]
    res = change(college, kind="cancel", section_id=cls["section_id"], start_period=cls["start_period"],
                 end_period=cls["end_period"], leave_id=hk["id"])
    assert res.status_code == 409 and "isn't approved" in res.json()["detail"]

    done = decide(college, hk["id"], "approve", cse).json()
    assert done["status"] == "approved" and done["decided_by"] == "HOD (CSE), Dr. Head"
    assert decide(college, hk["id"], "reject", cse).status_code == 409  # already decided

    # The ECE HOD rejects with a note: no cover needed, and the teacher sees why.
    r = decide(college, bs["id"], "reject", ece, note="Exams that day").json()
    assert r["status"] == "rejected" and r["decision_note"] == "Exams that day"
    by_teacher = {lv["teacher_id"]: lv for lv in cover(college)["leaves"]}
    assert by_teacher["BS"]["classes"] == []

    # A new HOD link revokes the previous one.
    hod_key(college, "CSE")
    assert client.get(f"/colleges/{code}/hod", headers=cse).status_code == 403


def test_without_an_hod_the_dean_approves(college: dict[str, Any]) -> None:
    lv = leave(college, "HK").json()
    assert lv["waiting_for"] == "the Dean"
    heads = client.get(f"/colleges/{college['code']}/departments/heads", headers=college["admin"]).json()
    assert {h["department_id"]: h["has_link"] for h in heads} == {"CSE": False, "ECE": False}
    done = decide(college, lv["id"], "approve", college["admin"]).json()
    assert done["status"] == "approved" and done["decided_by"] == "Dean"
