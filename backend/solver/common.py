"""Helpers shared by the pre-checks and the CP-SAT model."""

from .models import Assignment, CollegeData, Room, Section, Settings, Subject


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


def lab_starts(settings: Settings, block: int) -> list[int]:
    """0-based periods where a lab block of this length can start without crossing a break or day end."""
    return [s for seg in lab_segments(settings) for s in seg if s + block <= seg.stop]


def room_uses(data: CollegeData) -> dict[str, str]:
    """Room type id -> its use (lecture / lab / event)."""
    return {t.id: t.use for t in data.room_types}


def room_allowed_for(room: Room, section: Section) -> bool:
    return room.capacity >= section.strength and room.department_id in (None, section.department_id)


def lecture_rooms(data: CollegeData, section: Section) -> list[Room]:
    uses = room_uses(data)
    return [r for r in data.rooms if uses.get(r.type) == "lecture" and room_allowed_for(r, section)]


def lab_rooms(data: CollegeData, section: Section, subject: Subject) -> list[Room]:
    uses = room_uses(data)
    return [
        r
        for r in data.rooms
        if uses.get(r.type) == "lab"
        and room_allowed_for(r, section)
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
