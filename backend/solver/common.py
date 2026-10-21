"""Helpers shared by the pre-checks and the CP-SAT model."""

from .models import Assignment, CollegeData, Room, RoomType, Section, Settings, Subject


def day_segments(settings: Settings) -> list[range]:
    """Runs of back-to-back periods in a day (0-based), split by lunch."""
    n = settings.periods_per_day
    lunch = settings.lunch_after_period
    if lunch is None:
        return [range(0, n)]
    return [range(0, lunch), range(lunch, n)]


def lab_starts(settings: Settings, block: int) -> list[int]:
    """0-based periods where a lab block of this length can start without crossing lunch or day end."""
    return [s for seg in day_segments(settings) for s in seg if s + block <= seg.stop]


def room_allowed_for(room: Room, section: Section) -> bool:
    return room.capacity >= section.strength and room.department_id in (None, section.department_id)


def lecture_rooms(data: CollegeData, section: Section) -> list[Room]:
    return [r for r in data.rooms if r.type == RoomType.CLASSROOM and room_allowed_for(r, section)]


def lab_rooms(data: CollegeData, section: Section, subject: Subject) -> list[Room]:
    return [
        r
        for r in data.rooms
        if r.type == RoomType.LAB
        and room_allowed_for(r, section)
        and (subject.lab_room_ids is None or r.id in subject.lab_room_ids)
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
