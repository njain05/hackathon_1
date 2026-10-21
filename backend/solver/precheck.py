"""Checks that run before the solver.

`validate_data` finds broken input (unknown ids, impossible lab blocks).
`find_shortages` finds resources that are clearly too small, and explains
which one is short in plain words, so the admin knows what to fix.
"""

from collections import Counter, defaultdict

from .common import Index, day_segments, lab_rooms, lab_teacher, lecture_rooms
from .models import CollegeData, Problem, Room


def _dupes(ids: list[str]) -> list[str]:
    return sorted(i for i, n in Counter(ids).items() if n > 1)


def validate_data(data: CollegeData) -> list[Problem]:
    idx = Index(data)
    problems: list[Problem] = []

    def bad(msg: str, fix: str = "") -> None:
        if not fix and "unknown" in msg:
            fix = "Check the id is spelled correctly, or add the missing item."
        problems.append(Problem(kind="invalid_data", message=msg, suggestion=fix))

    for label, items in [
        ("department", data.departments),
        ("section", data.sections),
        ("subject", data.subjects),
        ("teacher", data.teachers),
        ("room", data.rooms),
    ]:
        for d in _dupes([x.id for x in items]):
            bad(f'Two {label}s share the id "{d}".', "Give every item a unique id.")

    for s in data.sections:
        if s.department_id not in idx.departments:
            bad(f'Section {s.name} belongs to unknown department "{s.department_id}".')
    for sub in data.subjects:
        if sub.department_id not in idx.departments:
            bad(f'Subject {sub.name} belongs to unknown department "{sub.department_id}".')
        for rid in sub.lab_room_ids or []:
            if rid not in idx.rooms:
                bad(f'Subject {sub.name} lists unknown lab room "{rid}".')
        if sub.lab_hours % sub.lab_block_length:
            bad(
                f"{sub.name} has {sub.lab_hours} lab periods, which can't be split into "
                f"blocks of {sub.lab_block_length}.",
                "Make lab hours a multiple of the lab block length.",
            )
        longest = max(len(seg) for seg in day_segments(data.settings))
        if sub.lab_hours and sub.lab_block_length > longest:
            bad(
                f"{sub.name} needs {sub.lab_block_length} periods in a row for a lab, but the "
                f"longest stretch without a break is {longest} periods.",
                "Shorten the lab block or move the lunch break.",
            )
    for t in data.teachers:
        if t.department_id not in idx.departments:
            bad(f'Teacher {t.name} belongs to unknown department "{t.department_id}".')
    for r in data.rooms:
        if r.department_id is not None and r.department_id not in idx.departments:
            bad(f'Room {r.name} belongs to unknown department "{r.department_id}".')

    pairs: set[tuple[str, str]] = set()
    for a in data.assignments:
        where = f"assignment ({a.section_id}, {a.subject_id})"
        if a.section_id not in idx.sections:
            bad(f'An {where} uses unknown section "{a.section_id}".')
        if a.subject_id not in idx.subjects:
            bad(f'An {where} uses unknown subject "{a.subject_id}".')
        for tid in {a.teacher_id, lab_teacher(a)}:
            if tid not in idx.teachers:
                bad(f'An {where} uses unknown teacher "{tid}".')
        if (a.section_id, a.subject_id) in pairs:
            bad(f"The {where} appears twice.", "Keep one teacher assignment per subject per section.")
        pairs.add((a.section_id, a.subject_id))
    return problems


def _names(rooms: list[Room]) -> str:
    return ", ".join(r.name for r in rooms)


def find_shortages(data: CollegeData) -> list[Problem]:
    """Necessary conditions. If any fails, no timetable can exist. Assumes valid data."""
    idx = Index(data)
    s = data.settings
    slots = len(s.days) * s.periods_per_day
    problems: list[Problem] = []

    section_need: dict[str, int] = defaultdict(int)
    teacher_need: dict[str, int] = defaultdict(int)
    # demand grouped by the exact set of rooms it may use
    lecture_demand: dict[frozenset[str], int] = defaultdict(int)
    lab_demand: dict[frozenset[str], int] = defaultdict(int)

    for a in data.assignments:
        sec, sub = idx.sections[a.section_id], idx.subjects[a.subject_id]
        section_need[sec.id] += sub.lecture_hours + sub.lab_hours
        teacher_need[a.teacher_id] += sub.lecture_hours
        teacher_need[lab_teacher(a)] += sub.lab_hours

        if sub.lecture_hours:
            rooms = lecture_rooms(data, sec)
            if not rooms:
                problems.append(Problem(
                    kind="no_room",
                    message=f"No classroom can hold {sec.name} ({sec.strength} students) "
                    f"for {sub.name}.",
                    suggestion="Add a bigger classroom for this department, or a shared one.",
                ))
            lecture_demand[frozenset(r.id for r in rooms)] += sub.lecture_hours
        if sub.lab_hours:
            rooms = lab_rooms(data, sec, sub)
            if not rooms:
                problems.append(Problem(
                    kind="no_room",
                    message=f"No lab room fits {sub.name} labs for {sec.name} "
                    f"({sec.strength} students).",
                    suggestion="Add a suitable lab, raise a lab's capacity, or change the "
                    "subject's allowed lab rooms.",
                ))
            lab_demand[frozenset(r.id for r in rooms)] += sub.lab_hours

    for sid, need in section_need.items():
        if need > slots:
            problems.append(Problem(
                kind="section_overload",
                message=f"{idx.sections[sid].name} needs {need} periods a week, but the week "
                f"has only {slots} teaching periods.",
                suggestion="Reduce its subject hours, or add periods or a working day.",
            ))

    for tid, need in teacher_need.items():
        t = idx.teachers[tid]
        cap = slots
        why = f"the week has only {slots} teaching periods"
        if t.max_periods_per_day is not None and t.max_periods_per_day * len(s.days) < cap:
            cap = t.max_periods_per_day * len(s.days)
            why = f"their limit of {t.max_periods_per_day} a day allows only {cap}"
        if need > cap:
            problems.append(Problem(
                kind="teacher_overload",
                message=f"{t.name} is assigned {need} periods a week, but {why}.",
                suggestion="Give some of their classes to another teacher.",
            ))

    # Hall's condition: demand that can only use rooms in set E must fit in E.
    for label, demand in (("classroom", lecture_demand), ("lab", lab_demand)):
        for room_set in {e for e in demand if e}:
            need = sum(d for e, d in demand.items() if e and e <= room_set)
            have = len(room_set) * slots
            if need > have:
                rooms = [idx.rooms[r] for r in sorted(room_set)]
                problems.append(Problem(
                    kind=f"{label}_shortage",
                    message=f"Not enough {label} time: classes that can only use "
                    f"{_names(rooms)} need {need} periods a week, but these rooms have "
                    f"only {have}.",
                    suggestion=f"Add another {label}, let more sections share rooms, or add "
                    "a working day.",
                ))
    return problems
