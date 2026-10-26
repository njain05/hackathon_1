"""Helpers shared by the pre-checks and the CP-SAT model."""

from .models import Assignment, CollegeData, ElectiveOption, Room, Section, Settings, Subject


def _runs(settings: Settings, cut_after: set[int]) -> list[range]:
    """Split a day's 0-based periods after each 1-based period in `cut_after`."""
    n = settings.periods_per_day
    cuts = sorted(c for c in cut_after if 0 < c < n)
    bounds = [0, *cuts, n]
    return [range(a, b) for a, b in zip(bounds, bounds[1:])]


def lab_segments(settings: Settings) -> list[range]:
    """Stretches of periods a lab block may span (split by breaks labs can't run across)."""
    return _runs(settings, {b.after_period for b in settings.breaks if not b.labs_continue})


def rest_segments(settings: Settings) -> list[range]:
    """Stretches of periods with no break at all (any break gives teachers a rest)."""
    return _runs(settings, {b.after_period for b in settings.breaks})


def lab_starts(settings: Settings, block: int, day_periods: int | None = None) -> list[int]:
    """0-based periods where a lab block of this length can start without crossing a break or
    the end of the day (`day_periods` for a short day)."""
    end = settings.periods_per_day if day_periods is None else day_periods
    return [s for seg in lab_segments(settings) for s in seg if s + block <= min(seg.stop, end)]


def room_uses(data: CollegeData) -> dict[str, str]:
    """Room type id -> its use (lecture / lab / event)."""
    return {t.id: t.use for t in data.room_types}


def department_may_use(room: Room, department_id: str) -> bool:
    """Shared rooms, the department's own rooms, and rooms another department shared with it."""
    return room.department_id in (None, department_id) or department_id in room.shared_with


def room_allowed_for(room: Room, section: Section, strength: int | None = None) -> bool:
    """`strength` overrides the section's (a lab batch only needs room for itself)."""
    need = section.strength if strength is None else strength
    return room.capacity >= need and department_may_use(room, section.department_id)


def elective_rooms(data: CollegeData, option: ElectiveOption) -> list[Room]:
    """Lecture rooms that seat the option's students, usable by the department offering it."""
    uses = room_uses(data)
    subject = next((s for s in data.subjects if s.id == option.subject_id), None)
    dept = subject.department_id if subject else ""
    return [
        r
        for r in data.rooms
        if uses.get(r.type) == "lecture" and r.capacity >= option.students and department_may_use(r, dept)
    ]


def lecture_rooms(data: CollegeData, section: Section) -> list[Room]:
    uses = room_uses(data)
    return [r for r in data.rooms if uses.get(r.type) == "lecture" and room_allowed_for(r, section)]


def lab_rooms(data: CollegeData, section: Section, subject: Subject, strength: int | None = None) -> list[Room]:
    uses = room_uses(data)
    return [
        r
        for r in data.rooms
        if uses.get(r.type) == "lab"
        and room_allowed_for(r, section, strength)
        and (subject.lab_room_type is None or r.type == subject.lab_room_type)
    ]


def lab_teacher(a: Assignment) -> str:
    return a.lab_teacher_id or a.teacher_id


class Index:
    """Fast id -> object lookups."""

    def __init__(self, data: CollegeData) -> None:
        self.sections = {s.id: s for s in data.sections}
        self.subjects = {s.id: s for s in data.subjects}
        self.teachers = {t.id: t for t in data.teachers}
        self.rooms = {r.id: r for r in data.rooms}
        self.departments = {d.id: d for d in data.departments}
        self.room_types = {t.id: t for t in data.room_types}
        self.day_pos = {d: i for i, d in enumerate(data.settings.days)}


def batches_for(a: Assignment, section: Section) -> list[tuple[str | None, int]]:
    """Who sits each lab session: [(batch id, strength)], or [(None, section strength)] when not in batches."""
    if a.lab_by_batch and section.batches:
        return [(b.id, b.strength) for b in section.batches]
    return [(None, section.strength)]
