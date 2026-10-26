from collections import Counter

import pytest

from solver import CollegeData, SolveResult, check_timetable, sample_college, solve
from solver.models import (
    Assignment, Break, Department, Room, Section, Settings, Slot, Subject, Teacher,
)


def test_sample_college_solves_with_zero_clashes(sample_result: SolveResult) -> None:
    assert sample_result.status == "solved"
    assert sample_result.check is not None
    assert sample_result.check.clashes == []
    assert sample_result.check.violations == []
    assert sample_result.check.ok


def test_independent_checker_agrees(sample_result: SolveResult) -> None:
    report = check_timetable(sample_college(), sample_result.entries)
    assert report.ok, report


def test_no_double_booking_counted_directly(sample_result: SolveResult) -> None:
    """Belt and braces: count (resource, day, period) pairs without the checker."""
    for attr in ("teacher_id", "section_id", "room_id"):
        used = Counter((getattr(e, attr), e.day, e.period) for e in sample_result.entries)
        assert max(used.values()) == 1, f"double booking on {attr}"


def test_every_assignment_gets_its_hours(sample_result: SolveResult) -> None:
    data = sample_college()
    subjects = {s.id: s for s in data.subjects}
    got = Counter((e.section_id, e.subject_id, e.kind) for e in sample_result.entries)
    for a in data.assignments:
        sub = subjects[a.subject_id]
        assert got[a.section_id, a.subject_id, "lecture"] == sub.lecture_hours
        assert got[a.section_id, a.subject_id, "lab"] == sub.lab_hours


def test_labs_are_consecutive_in_lab_rooms_and_skip_lunch(sample_result: SolveResult) -> None:
    data = sample_college()
    rooms = {r.id: r for r in data.rooms}
    uses = {t.id: t.use for t in data.room_types}
    lunch = next(b.after_period for b in data.settings.breaks if b.name == "Lunch")
    labs: dict[tuple[str, str, str], list[int]] = {}
    for e in sample_result.entries:
        if e.kind == "lab":
            assert uses[rooms[e.room_id].type] == "lab"
            labs.setdefault((e.section_id, e.subject_id, e.day), []).append(e.period)
    assert labs, "sample data should contain labs"
    for periods in labs.values():
        periods.sort()
        assert len(periods) == 2  # one 2-period block per day
        assert periods[1] == periods[0] + 1
        assert periods[0] != lunch  # block doesn't straddle lunch


def test_room_capacity_and_department_respected(sample_result: SolveResult) -> None:
    data = sample_college()
    rooms = {r.id: r for r in data.rooms}
    sections = {s.id: s for s in data.sections}
    uses = {t.id: t.use for t in data.room_types}
    for e in sample_result.entries:
        room, sec = rooms[e.room_id], sections[e.section_id]
        assert room.capacity >= sec.strength
        assert room.department_id in (None, sec.department_id)
        assert uses[room.type] != "event"  # halls stay free for events


def test_soft_rules_reported(sample_result: SolveResult) -> None:
    assert sample_result.stats is not None
    assert set(sample_result.stats.penalties) == {
        "subject_repeats_same_day", "teacher_long_runs", "student_gaps", "teacher_load_imbalance",
    }


# ---------- Clear errors when no timetable is possible ----------

def test_section_overload_is_explained() -> None:
    data = sample_college()
    for sub in data.subjects:
        if sub.id in {"CS201", "MA201", "CS203"}:
            sub.lecture_hours = 8
    result = solve(data)
    assert result.status == "infeasible"
    kinds = {p.kind for p in result.problems}
    assert "section_overload" in kinds
    assert any("CSE 3rd Sem A" in p.message for p in result.problems)


def test_lab_shortage_is_explained() -> None:
    data = sample_college()
    data.rooms = [r for r in data.rooms if r.id != "CL-2"]
    for sub in data.subjects:
        if sub.department_id == "CSE" and sub.lab_hours:
            sub.lab_hours = 4
    result = solve(data)
    assert result.status == "infeasible"
    assert any(p.kind == "lab_shortage" and "Computer Lab 1" in p.message for p in result.problems)


def test_no_room_big_enough_is_explained() -> None:
    data = sample_college()
    data.sections[0].strength = 200
    result = solve(data)
    assert result.status == "infeasible"
    assert any(p.kind == "no_room" and "200 students" in p.message for p in result.problems)


def test_teacher_overload_is_explained() -> None:
    data = sample_college()
    for a in data.assignments:
        if a.section_id.startswith("CSE"):
            a.teacher_id = "HK"
    result = solve(data)
    assert result.status == "infeasible"
    assert any(p.kind == "teacher_overload" and "Harpreet" in p.message for p in result.problems)


def _tiny_lab_college(sections: int) -> CollegeData:
    """1 day, 4 periods, lunch after period 1: only ONE 2-period lab block fits per lab room."""
    return CollegeData(
        settings=Settings(days=["Mon"], periods_per_day=4,
                          breaks=[Break(name="Lunch", after_period=1, minutes=40)]),
        departments=[Department(id="d", name="Dept")],
        sections=[Section(id=f"s{i}", name=f"Section {i}", department_id="d", strength=30)
                  for i in range(sections)],
        subjects=[Subject(id="phy", code="PH1", name="Physics", department_id="d",
                          lecture_hours=0, lab_hours=2)],
        teachers=[Teacher(id=f"t{i}", name=f"Teacher {i}", department_id="d") for i in range(sections)],
        assignments=[Assignment(section_id=f"s{i}", subject_id="phy", teacher_id=f"t{i}")
                     for i in range(sections)],
        rooms=[Room(id="lab", name="Physics Lab", type="lab", capacity=40)],
    )


def test_hidden_lab_shortage_is_diagnosed() -> None:
    """Total lab periods fit (4 needed, 4 exist), but lunch splits the day so only one block fits."""
    assert solve(_tiny_lab_college(1)).status == "solved"
    result = solve(_tiny_lab_college(2))
    assert result.status == "infeasible"
    assert [p.kind for p in result.problems] == ["lab_shortage"]
    assert "Physics Lab" in result.problems[0].message


def test_invalid_data_is_reported() -> None:
    data = sample_college()
    data.assignments[0].teacher_id = "nobody"
    data.subjects[0].lab_hours = 3  # not a multiple of the 2-period block
    result = solve(data)
    assert result.status == "invalid"
    messages = " ".join(p.message for p in result.problems)
    assert '"nobody"' in messages
    assert "blocks of 2" in messages


def test_teacher_unavailable_times_are_respected() -> None:
    data = sample_college()
    hk = next(t for t in data.teachers if t.id == "HK")
    hk.unavailable = [Slot(day="Monday", period=p) for p in range(1, 8)] + [Slot(day="Friday", period=1)]
    result = solve(data)
    assert result.status == "solved"
    assert result.check is not None and result.check.ok
    assert not [e for e in result.entries if e.teacher_id == "HK" and (e.day == "Monday" or (e.day == "Friday" and e.period == 1))]


def test_labs_may_run_across_a_break_only_when_allowed() -> None:
    """2 periods with a tea break between them: a 2-period lab only fits across the break."""
    data = _tiny_lab_college(1)
    data.settings = Settings(days=["Mon"], periods_per_day=2,
                             breaks=[Break(name="Tea", after_period=1, minutes=10)])
    assert solve(data).status == "invalid"  # no stretch of 2 periods without a break
    data.settings.breaks[0].labs_continue = True
    result = solve(data)
    assert result.status == "solved" and result.check is not None and result.check.ok


def test_unknown_room_type_is_reported() -> None:
    data = sample_college()
    data.rooms[0].type = "hall-of-fame"
    result = solve(data)
    assert result.status == "invalid"
    assert result.problems[0].step == "rooms"


def test_few_workers_still_give_a_clash_free_timetable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Small servers run with SOLVER_WORKERS=2: the result must stay clash-free."""
    monkeypatch.setenv("SOLVER_WORKERS", "2")
    result = solve(sample_college(), time_limit_seconds=10)
    assert result.status == "solved"
    assert result.check is not None and result.check.ok
