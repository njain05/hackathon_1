from solver import check_timetable, sample_college
from solver.models import Entry


def _e(**kw: object) -> Entry:
    base: dict[str, object] = dict(day="Monday", period=1, section_id="CSE-3A", subject_id="CS201",
                                   teacher_id="HK", room_id="C-101", kind="lecture")
    base.update(kw)
    return Entry.model_validate(base)


def _clash_kinds(entries: list[Entry]) -> set[str]:
    return {c.kind for c in check_timetable(sample_college(), entries).clashes}


def test_detects_teacher_clash() -> None:
    entries = [_e(), _e(section_id="CSE-5A", subject_id="CS305", room_id="C-102")]
    assert _clash_kinds(entries) == {"teacher_clash"}


def test_detects_section_clash() -> None:
    entries = [_e(), _e(subject_id="MA201", teacher_id="PS", room_id="C-102")]
    assert _clash_kinds(entries) == {"section_clash"}


def test_detects_room_clash() -> None:
    entries = [_e(), _e(section_id="CSE-3B", subject_id="MA201", teacher_id="PS")]
    assert _clash_kinds(entries) == {"room_clash"}


def test_clash_message_is_readable() -> None:
    report = check_timetable(sample_college(), [_e(), _e(section_id="CSE-5A", subject_id="CS305", room_id="C-102")])
    assert report.clashes[0].message == (
        "Dr. Harpreet Kaur has 2 classes on Monday period 1 (CSE 3rd Sem A, CSE 5th Sem A)."
    )
    assert not report.ok


def test_detects_rule_violations() -> None:
    entries = [
        _e(room_id="E-202"),                                   # 50 seats, ECE-only room
        _e(period=2, kind="lab", room_id="C-101"),             # lab in a classroom
        _e(period=4, kind="lab", room_id="CL-1", subject_id="CS203", teacher_id="AS"),
        _e(period=5, kind="lab", room_id="CL-1", subject_id="CS203", teacher_id="AS"),  # crosses lunch
        _e(period=3, teacher_id="NS"),                     # wrong teacher
    ]
    kinds = {v.kind for v in check_timetable(sample_college(), entries).violations}
    assert {"capacity", "room_department", "lab_room", "lab_block", "wrong_teacher", "hours"} <= kinds
