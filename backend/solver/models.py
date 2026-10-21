"""Input and output models for the timetable solver.

Everything about a college (days, periods, breaks, room types...) comes from data,
so the same solver works for any college.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


RoomUse = Literal["lecture", "lab", "event"]


class RoomType(BaseModel):
    """Admin-defined kind of room, e.g. "Computer lab" used for labs."""

    id: str
    name: str
    use: RoomUse = Field(description="lecture = classes, lab = lab sessions, event = never used for classes")


DEFAULT_ROOM_TYPES = [
    RoomType(id="classroom", name="Classroom", use="lecture"),
    RoomType(id="lab", name="Lab", use="lab"),
    RoomType(id="seminar_hall", name="Seminar hall", use="event"),
    RoomType(id="auditorium", name="Auditorium", use="event"),
]

_HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class Break(BaseModel):
    name: str = "Break"
    after_period: int = Field(ge=1, description="The break comes after this period (1-based)")
    minutes: int = Field(ge=1, le=240)
    labs_continue: bool = Field(
        False, description="True if a lab may run across this break (e.g. a short tea break)"
    )


class Settings(BaseModel):
    days: list[str] = Field(min_length=1, description="Working days, in order")
    periods_per_day: int = Field(ge=1, le=16, description="Teaching periods per day")
    day_start: str = Field("09:00", pattern=_HHMM)
    period_minutes: int = Field(50, ge=10, le=240)
    period_lengths: list[int] | None = Field(
        None, description="Optional minutes for each period, if they differ"
    )
    breaks: list[Break] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if len(set(self.days)) != len(self.days):
            raise ValueError("Day names must be unique")
        afters = [b.after_period for b in self.breaks]
        if len(set(afters)) != len(afters):
            raise ValueError("Two breaks come after the same period")
        if any(a >= self.periods_per_day for a in afters):
            raise ValueError("A break must come before the last period of the day")
        if self.period_lengths is not None and len(self.period_lengths) != self.periods_per_day:
            raise ValueError("period_lengths must have one entry per period")
        return self


class Department(BaseModel):
    id: str
    name: str


class Section(BaseModel):
    id: str
    name: str
    department_id: str
    strength: int = Field(ge=1, description="Number of students")


class Subject(BaseModel):
    id: str
    code: str
    name: str
    department_id: str
    lecture_hours: int = Field(ge=0, description="Lecture periods per week")
    lab_hours: int = Field(0, ge=0, description="Lab periods per week")
    lab_block_length: int = Field(2, ge=1, description="Consecutive periods per lab session")
    lab_room_type: str | None = Field(
        None, description="If set, labs only use rooms of this type (e.g. computer_lab)"
    )


class Slot(BaseModel):
    day: str
    period: int = Field(ge=1)


class Teacher(BaseModel):
    id: str
    name: str
    department_id: str = Field(description="Home department; teachers may teach any department")
    max_periods_per_day: int | None = Field(None, ge=1)
    unavailable: list[Slot] = Field(default_factory=list, description="Periods they can't teach")


class Assignment(BaseModel):
    """Who teaches which subject to which section."""

    section_id: str
    subject_id: str
    teacher_id: str
    lab_teacher_id: str | None = Field(None, description="Defaults to teacher_id")


class Room(BaseModel):
    id: str
    name: str
    type: str = Field(description="Id of a room type")
    capacity: int = Field(ge=1)
    department_id: str | None = Field(
        None, description="If set, only this department's sections use it; None = shared"
    )


class CollegeData(BaseModel):
    name: str = "My College"
    settings: Settings
    room_types: list[RoomType] = Field(default_factory=lambda: list(DEFAULT_ROOM_TYPES))
    departments: list[Department]
    sections: list[Section]
    subjects: list[Subject]
    teachers: list[Teacher]
    assignments: list[Assignment]
    rooms: list[Room]


# ---------- Output ----------

EntryKind = Literal["lecture", "lab"]


class Entry(BaseModel):
    """One section in one room for one period."""

    day: str
    period: int = Field(description="1-based period number")
    section_id: str
    subject_id: str
    teacher_id: str
    room_id: str
    kind: EntryKind


class Problem(BaseModel):
    """A human-readable reason why no timetable could be made."""

    kind: str
    message: str
    suggestion: str = ""
    step: str | None = Field(
        None, description="Setup step to fix it in: week, rooms, teachers, sections, subjects"
    )


class Issue(BaseModel):
    """Something wrong found by the clash checker."""

    kind: str  # teacher_clash | section_clash | room_clash | capacity | lab_room | ...
    message: str
    day: str | None = None
    period: int | None = None


class CheckReport(BaseModel):
    ok: bool
    clashes: list[Issue]
    violations: list[Issue]


class SolveStats(BaseModel):
    solver_status: str
    optimal: bool
    wall_time_seconds: float
    score: int = Field(description="Weighted soft-rule penalty; lower is better")
    penalties: dict[str, int] = Field(description="Raw count per soft rule")


class SolveResult(BaseModel):
    status: Literal["solved", "infeasible", "invalid", "timeout"]
    entries: list[Entry] = []
    problems: list[Problem] = []
    stats: SolveStats | None = None
    check: CheckReport | None = None
