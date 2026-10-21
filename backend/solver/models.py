"""Input and output models for the timetable solver.

Everything about a college (days, periods, lunch, rooms...) comes from data,
so the same solver works for any college.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class RoomType(StrEnum):
    CLASSROOM = "classroom"
    LAB = "lab"
    SEMINAR_HALL = "seminar_hall"
    AUDITORIUM = "auditorium"


class Settings(BaseModel):
    days: list[str] = Field(min_length=1, description="Working days, in order")
    periods_per_day: int = Field(ge=1, le=16, description="Teaching periods per day")
    lunch_after_period: int | None = Field(
        None,
        ge=1,
        description="Lunch break comes after this period (1-based). None = no lunch break.",
    )
    period_times: list[str] | None = Field(
        None, description='Optional labels per period, e.g. "09:00-09:50"'
    )

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if len(set(self.days)) != len(self.days):
            raise ValueError("Day names must be unique")
        if self.lunch_after_period is not None and self.lunch_after_period >= self.periods_per_day:
            raise ValueError("lunch_after_period must be smaller than periods_per_day")
        if self.period_times is not None and len(self.period_times) != self.periods_per_day:
            raise ValueError("period_times must have one entry per period")
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
    lab_room_ids: list[str] | None = Field(
        None, description="If set, labs may only use these rooms (e.g. electronics labs)"
    )


class Teacher(BaseModel):
    id: str
    name: str
    department_id: str
    max_periods_per_day: int | None = Field(None, ge=1)


class Assignment(BaseModel):
    """Who teaches which subject to which section."""

    section_id: str
    subject_id: str
    teacher_id: str
    lab_teacher_id: str | None = Field(None, description="Defaults to teacher_id")


class Room(BaseModel):
    id: str
    name: str
    type: RoomType
    capacity: int = Field(ge=1)
    department_id: str | None = Field(
        None, description="If set, only this department's sections use it; None = shared"
    )


class CollegeData(BaseModel):
    name: str = "My College"
    settings: Settings
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
