"""Explain why the solver found no timetable.

The pre-checks catch simple shortages. When the solver still proves "no
timetable exists", we re-solve with one group of hard rules switched off at a
time. If dropping a group makes it solvable, that group is the bottleneck.
"""

from collections import defaultdict

from .common import Index, lab_teacher, room_uses
from .cpsat import RELAXABLE, solve_model
from .models import CollegeData, Problem


def _busiest(load: dict[str, int], names: dict[str, str], cap: int) -> str:
    top = sorted(load.items(), key=lambda kv: -kv[1])[:3]
    return ", ".join(f"{names[k]} ({v}/{cap})" for k, v in top)


def _explain(group: str, data: CollegeData) -> Problem:
    idx = Index(data)
    slots = len(data.settings.days) * data.settings.periods_per_day
    teacher_load: dict[str, int] = defaultdict(int)
    section_load: dict[str, int] = defaultdict(int)
    for a in data.assignments:
        sub = idx.subjects[a.subject_id]
        teacher_load[a.teacher_id] += sub.lecture_hours
        teacher_load[lab_teacher(a)] += sub.lab_hours
        section_load[a.section_id] += sub.lecture_hours + sub.lab_hours

    uses = room_uses(data)

    def room_names(use: str) -> str:
        return ", ".join(r.name for r in data.rooms if uses.get(r.type) == use)

    if group == "lab_rooms":
        return Problem(
            kind="lab_shortage", step="rooms",
            message="Lab rooms are the bottleneck. Each lab needs a block of consecutive "
            "periods in a suitable lab, and breaks and the end of the day limit where "
            f"blocks fit. There aren't enough free lab blocks in: {room_names('lab')}.",
            suggestion="Add a lab room, allow labs in more rooms, add a working day, or "
            "shorten some lab blocks.",
        )
    if group == "classrooms":
        return Problem(
            kind="classroom_shortage", step="rooms",
            message="Classrooms are the bottleneck. There aren't enough free classroom "
            f"periods for every lecture: {room_names('lecture')}.",
            suggestion="Add a classroom, let departments share rooms, or add a working day.",
        )
    if group == "teachers":
        names = {t.id: t.name for t in data.teachers}
        return Problem(
            kind="teacher_shortage", step="subjects",
            message="Teachers are the bottleneck. Some teachers' classes can't all be fitted "
            f"without overlapping. Busiest: {_busiest(teacher_load, names, slots)}.",
            suggestion="Move some classes from the busiest teachers to colleagues.",
        )
    if group == "teacher_availability":
        return Problem(
            kind="teacher_unavailable", step="teachers",
            message="Teachers' unavailable times leave too few periods to fit their classes "
            "without clashes.",
            suggestion="Free up some unavailable times, or move classes to other teachers.",
        )
    if group == "teacher_daily_max":
        return Problem(
            kind="teacher_daily_limit", step="teachers",
            message="Teachers' 'max periods per day' limits are too strict to fit everything.",
            suggestion="Raise the daily limits, or spread their classes over more days.",
        )
    names = {sec.id: sec.name for sec in data.sections}
    return Problem(
        kind="section_shortage", step="subjects",
        message="Section timetables are too full to fit every class around the shared "
        f"teachers and rooms. Fullest: {_busiest(section_load, names, slots)}.",
        suggestion="Reduce weekly hours for these sections, or add periods or a working day.",
    )


def diagnose(data: CollegeData, time_limit_seconds: float = 5.0) -> list[Problem]:
    skip: set[str] = set()
    if not any(t.max_periods_per_day is not None for t in data.teachers):
        skip.add("teacher_daily_max")
    if not any(t.unavailable for t in data.teachers):
        skip.add("teacher_availability")
    found = []
    for group in RELAXABLE:
        if group in skip:
            continue
        out = solve_model(data, time_limit_seconds, relax=frozenset({group}), optimize=False)
        if out.status in ("OPTIMAL", "FEASIBLE"):
            found.append(_explain(group, data))
    if found:
        return found
    return [Problem(
        kind="too_tight",
        message="No timetable fits all the rules. Teachers, sections and rooms are all "
        "close to full, and no single one of them is the only cause.",
        suggestion="Add a working day or period, or reduce weekly hours.",
    )]
