"""Teacher leave, substitutes, cancelled and extra classes: daily changes on top
of the published timetable. The timetable itself is never regenerated.

A day's actual timetable = the published week's entries for that weekday, with
that date's changes applied in order. Every change is validated by building
the day it would produce and running the independent clash checker on it, so
the real day stays clash-free (plus leave and daily-max rules the checker
doesn't know about).
"""

import hmac
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from solver import CollegeData, check_timetable
from solver.models import CheckReport, Entry

from .bookings import today
from .colleges import AdminCollegeDep, DbSession, find_college, hash_key, latest
from .db import College, DayChange, Leave, as_utc, now
from .members import MemberDep, can_manage_department, department_name, head_of, member_access, published_data, require_role

router = APIRouter(tags=["changes"])

# On one changed day these are expected: weekly totals can't match a single
# day, and a substitute or extra-class teacher isn't the assigned one.
EXPECTED_ON_A_DAY = {"hours", "wrong_teacher"}
MAX_RANGE_DAYS = 31
MAX_DAYS_AHEAD = 366


# ---------- Models ----------


class NewLeave(BaseModel):
    teacher_id: str | None = Field(None, description="Left out with a teacher's link: their own leave")
    date: date
    start_period: int | None = Field(None, ge=1, description="Leave out for the whole day")
    end_period: int | None = Field(None, ge=1)
    reason: str = Field("", max_length=300)


class LeaveOut(BaseModel):
    id: int
    teacher_id: str
    date: date
    start_period: int
    end_period: int
    reason: str
    by: str
    status: Literal["pending", "approved", "rejected"]
    waiting_for: str | None = Field(description='While pending: "HOD (CSE)", or "the admin" if the department has no HOD link')
    waiting_since: str | None
    decided_by: str
    decision_note: str
    decided_at: str | None
    created_at: str


class LeaveDecision(BaseModel):
    action: Literal["approve", "reject"]
    note: str = Field("", max_length=300)


class HodView(BaseModel):
    """An HOD's page: their department's leave requests."""

    department_id: str
    department_name: str
    name: str
    college_name: str
    leaves: list[LeaveOut]


class ChangeIn(BaseModel):
    date: date
    kind: Literal["substitute", "cancel", "extra"]
    section_id: str
    start_period: int = Field(ge=1)
    end_period: int | None = Field(None, ge=1, description="Defaults to start_period")
    new_teacher_id: str | None = Field(None, description="substitute: who takes the class")
    subject_id: str | None = Field(None, description="extra: which subject")
    teacher_id: str | None = Field(
        None,
        description="extra: who teaches it (default: the assigned teacher). substitute/cancel: whose class it is "
        "(needed when two lab batches of the section share the slot with different teachers)",
    )
    room_id: str | None = Field(None, description="extra: which room")
    note: str = Field("", max_length=300)
    leave_id: int | None = None


class ChangeOut(BaseModel):
    id: int
    date: date
    kind: str
    section_id: str
    subject_id: str
    start_period: int
    end_period: int
    teacher_id: str
    new_teacher_id: str | None
    room_id: str
    class_kind: str
    note: str
    leave_id: int | None


class DayView(BaseModel):
    """What actually happens on a date: the published week plus that date's changes."""

    date: date
    day: str = Field(description="Weekday name as the college writes it (or the English name if not a working day)")
    working_day: bool
    entries: list[Entry]
    changes: list[ChangeOut]
    check: CheckReport


class Suggestion(BaseModel):
    teacher_id: str
    tier: Literal["subject", "department", "anyone"]
    load_today: int = Field(description="Periods they already teach that day")


class AffectedClass(BaseModel):
    section_id: str
    subject_id: str
    start_period: int
    end_period: int
    room_id: str
    class_kind: str
    batch: str | None = None
    state: Literal["awaiting_approval", "needs_cover", "substitute", "cancelled"]
    change_id: int | None = None
    new_teacher_id: str | None = None
    suggestions: list[Suggestion]


class LeaveCover(LeaveOut):
    classes: list[AffectedClass]


class CoverView(BaseModel):
    """Admin: one date's leave, the classes it affects, and every change."""

    date: date
    day: str
    working_day: bool
    leaves: list[LeaveCover]
    changes: list[ChangeOut]
    check: CheckReport


class SlotOption(BaseModel):
    period: int
    ok: bool
    reason: str | None = None
    rooms: list[str] = Field(default_factory=list, description="Free rooms that suit the section, smallest first")


# ---------- The day ----------


@dataclass
class Day:
    college: College
    data: CollegeData
    base: list[Entry]  # the published week, all days
    date: date
    day: str
    working: bool
    changes: list[DayChange]
    leaves: list[Leave]


def college_day(data: CollegeData, d: date) -> tuple[str, bool]:
    """The college's own name for this date's weekday ("Monday", "Mon"…), or the English name if not a working day."""
    weekday = d.strftime("%A")
    match = next((x for x in data.settings.days if x.strip().lower()[:3] == weekday.lower()[:3]), None)
    return (match, True) if match is not None else (weekday, False)


def load_day(session: Session, college: College, d: date) -> Day:
    pub = latest(session, college)
    if pub is None:
        raise HTTPException(409, f"{college.name} hasn't published its timetable yet. Publish it first.")
    data = CollegeData.model_validate(pub.data)
    day, working = college_day(data, d)
    changes = list(session.scalars(
        select(DayChange).where(DayChange.college_id == college.id, DayChange.date == d.isoformat()).order_by(DayChange.id)
    ))
    leaves = list(session.scalars(
        select(Leave).where(Leave.college_id == college.id, Leave.date == d.isoformat()).order_by(Leave.id)
    ))
    base = [Entry.model_validate(e) for e in pub.result.get("entries", [])]
    return Day(college, data, base, d, day, working, changes, leaves)


def span(c: DayChange | Leave) -> range:
    return range(c.start_period, c.end_period + 1)


def actual(day: Day, changes: list[DayChange] | None = None) -> list[Entry]:
    """The published entries for this weekday with the changes applied, in order."""
    es = [e for e in day.base if e.day == day.day] if day.working else []
    for c in day.changes if changes is None else changes:
        # Only that teacher's class: two lab batches of one section may share the slot with different teachers.
        hit = lambda e, c=c: e.section_id == c.section_id and e.period in span(c) and e.teacher_id == c.teacher_id  # noqa: E731
        if c.kind == "cancel":
            es = [e for e in es if not hit(e)]
        elif c.kind == "substitute":
            es = [e.model_copy(update={"teacher_id": c.new_teacher_id}) if hit(e) else e for e in es]
        elif c.kind == "extra":
            es += [
                Entry(day=day.day, period=p, section_id=c.section_id, subject_id=c.subject_id,
                      teacher_id=c.teacher_id, room_id=c.room_id, kind="lecture")
                for p in span(c)
            ]
    return es


def day_check(day: Day, entries: list[Entry]) -> CheckReport:
    """The independent checker on one day, minus what is expected on a changed day."""
    data = day.data
    if not day.working:  # a makeup class on a day off: let the checker treat it as a teaching day
        data = data.model_copy(update={"settings": data.settings.model_copy(update={"days": [*data.settings.days, day.day]})})
    report = check_timetable(data, entries)
    violations = [v for v in report.violations if v.kind not in EXPECTED_ON_A_DAY]
    return CheckReport(ok=not report.clashes and not violations, clashes=report.clashes, violations=violations)


def on_leave(day: Day, teacher_id: str, periods: range) -> bool:
    """Away then: approved leave, or a request still waiting (so they're never picked as a substitute)."""
    return any(lv.teacher_id == teacher_id and lv.status != "rejected" and set(span(lv)) & set(periods) for lv in day.leaves)


def load(entries: list[Entry], teacher_id: str) -> int:
    return sum(1 for e in entries if e.teacher_id == teacher_id)


def unavailable(day: Day, teacher_id: str, periods: range) -> bool:
    t = next((x for x in day.data.teachers if x.id == teacher_id), None)
    return t is not None and any(s.day == day.day and s.period in periods for s in t.unavailable)


def over_max(day: Day, entries: list[Entry], teacher_id: str) -> int | None:
    """Their daily maximum, if this day goes over it."""
    t = next((x for x in day.data.teachers if x.id == teacher_id), None)
    if t is not None and t.max_periods_per_day is not None and load(entries, teacher_id) > t.max_periods_per_day:
        return t.max_periods_per_day
    return None


def suggest(day: Day, entries: list[Entry], section_id: str, subject_id: str, periods: range, absent: str) -> list[Suggestion]:
    """Who could take this class: free then, not unavailable, under their daily max, not on leave.
    Ranked: teaches this subject, then same department as the subject, then anyone; fewest classes that day first."""
    subject = next((s for s in day.data.subjects if s.id == subject_id), None)
    teaches = {a.teacher_id for a in day.data.assignments if a.subject_id == subject_id} | {
        a.lab_teacher_id for a in day.data.assignments if a.subject_id == subject_id and a.lab_teacher_id
    }
    busy = {(e.teacher_id, e.period) for e in entries}
    out: list[Suggestion] = []
    for t in day.data.teachers:
        if t.id == absent or on_leave(day, t.id, periods) or unavailable(day, t.id, periods):
            continue
        if any((t.id, p) in busy for p in periods):
            continue
        today_load = load(entries, t.id)
        if t.max_periods_per_day is not None and today_load + len(periods) > t.max_periods_per_day:
            continue
        tier: Literal["subject", "department", "anyone"] = (
            "subject" if t.id in teaches else "department" if subject and t.department_id == subject.department_id else "anyone"
        )
        out.append(Suggestion(teacher_id=t.id, tier=tier, load_today=today_load))
    order = {"subject": 0, "department": 1, "anyone": 2}
    names = {t.id: t.name for t in day.data.teachers}
    return sorted(out, key=lambda s: (order[s.tier], s.load_today, names.get(s.teacher_id, s.teacher_id)))


def classes_of(entries: list[Entry], teacher_id: str, periods: range) -> list[tuple[Entry, int, int]]:
    """A teacher's classes in these periods, with lab periods merged into one block."""
    mine = sorted((e for e in entries if e.teacher_id == teacher_id and e.period in periods), key=lambda e: (e.section_id, e.period))
    blocks: list[tuple[Entry, int, int]] = []
    for e in mine:
        last = blocks[-1] if blocks else None
        if (last and last[0].kind == "lab" == e.kind and last[0].section_id == e.section_id and last[0].subject_id == e.subject_id
                and last[0].batch == e.batch and last[2] == e.period - 1):
            blocks[-1] = (last[0], last[1], e.period)
        else:
            blocks.append((e, e.period, e.period))
    return sorted(blocks, key=lambda b: b[1])


def change_out(c: DayChange) -> ChangeOut:
    return ChangeOut(
        id=c.id, date=date.fromisoformat(c.date), kind=c.kind, section_id=c.section_id, subject_id=c.subject_id,
        start_period=c.start_period, end_period=c.end_period, teacher_id=c.teacher_id, new_teacher_id=c.new_teacher_id,
        room_id=c.room_id, class_kind=c.class_kind, note=c.note, leave_id=c.leave_id,
    )


def approver_title(session: Session, college: College, data: CollegeData | None, teacher_id: str) -> str:
    """Who approves this teacher's leave: their department's HOD if it has a link, else the admin."""
    dept = next((t.department_id for t in (data.teachers if data else []) if t.id == teacher_id), None)
    return f"HOD ({dept})" if head_of(session, college, dept) else "the admin"


def leave_out(lv: Leave, waiting_for: str | None = None) -> LeaveOut:
    pending = lv.status == "pending"
    return LeaveOut(
        id=lv.id, teacher_id=lv.teacher_id, date=date.fromisoformat(lv.date), start_period=lv.start_period,
        end_period=lv.end_period, reason=lv.reason, by=lv.by, status=lv.status,  # type: ignore[arg-type]
        waiting_for=waiting_for if pending else None,
        waiting_since=as_utc(lv.created_at).isoformat() if pending else None,
        decided_by=lv.decided_by, decision_note=lv.decision_note,
        decided_at=as_utc(lv.decided_at).isoformat() if lv.decided_at else None,
        created_at=as_utc(lv.created_at).isoformat(),
    )


def check_date(d: date) -> None:
    if d < today():
        raise HTTPException(400, "That date has passed. Choose today or a later date.")
    if d > today() + timedelta(days=MAX_DAYS_AHEAD):
        raise HTTPException(400, "Choose a date within the next year.")


def periods_of(day: Day, start: int | None, end: int | None) -> range:
    n = day.data.settings.periods_on(day.day)  # a short day (e.g. a 4-period Saturday) has fewer
    a, b = start or 1, end or (start if start and end is None else n)
    if not 1 <= a <= b <= n:
        raise HTTPException(400, f"Choose periods between 1 and {n}, the last one after the first.")
    return range(a, b + 1)


def is_admin(college: College, key: str | None) -> bool:
    return bool(key) and hmac.compare_digest(hash_key(key or ""), college.admin_key_hash)


# ---------- Public ----------


@router.get("/colleges/{ref}/day", response_model=DayView)
def get_day(ref: str, session: DbSession, on: Annotated[date, Query(alias="date")]) -> DayView:
    """Students and teachers: what actually happens on this date, changes included."""
    day = load_day(session, find_college(session, ref), on)
    entries = actual(day)
    return DayView(date=on, day=day.day, working_day=day.working, entries=entries,
                   changes=[change_out(c) for c in day.changes], check=day_check(day, entries))


@router.get("/colleges/{ref}/changes", response_model=list[ChangeOut])
def list_changes(
    ref: str, session: DbSession,
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date | None, Query(alias="to")] = None,
) -> list[ChangeOut]:
    """Changes between two dates (at most a month), e.g. for "coming up this week"."""
    college = find_college(session, ref)
    end = end or start
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(400, f"Choose a range of at most {MAX_RANGE_DAYS} days.")
    rows = session.scalars(
        select(DayChange)
        .where(DayChange.college_id == college.id, DayChange.date >= start.isoformat(), DayChange.date <= end.isoformat())
        .order_by(DayChange.date, DayChange.start_period, DayChange.id)
    )
    return [change_out(c) for c in rows]


@router.post("/colleges/{ref}/leaves", response_model=LeaveOut, status_code=201)
def add_leave(
    ref: str, body: NewLeave, session: DbSession,
    x_admin_key: Annotated[str | None, Header()] = None, x_member_key: Annotated[str | None, Header()] = None,
) -> LeaveOut:
    """Ask for leave. A teacher, with their own link, asks for themselves: it waits for their
    department's HOD. The admin may add anyone's leave: approved at once. Nothing changes for
    students until the admin assigns a substitute or cancels the class."""
    college = find_college(session, ref)
    admin = is_admin(college, x_admin_key)
    teacher_id = body.teacher_id
    if not admin:
        _, member = member_access(ref, session, x_member_key)
        require_role(member, "teacher")
        if teacher_id not in (None, member.teacher_id):
            raise HTTPException(403, "You can only ask for your own leave.")
        teacher_id = member.teacher_id
    check_date(body.date)
    day = load_day(session, college, body.date)
    if not teacher_id or teacher_id not in {t.id for t in day.data.teachers}:
        raise HTTPException(400, f"No teacher with the code \"{teacher_id}\".")
    periods = periods_of(day, body.start_period, body.end_period)
    if on_leave(day, teacher_id, periods):
        raise HTTPException(409, "There is already leave for some of these periods that day.")
    lv = Leave(college_id=college.id, teacher_id=teacher_id, date=body.date.isoformat(),
               start_period=periods.start, end_period=periods.stop - 1, reason=body.reason.strip(),
               by="admin" if admin else "teacher", status="approved" if admin else "pending",
               decided_by="Admin" if admin else "", decided_at=now() if admin else None)
    session.add(lv)
    session.commit()
    return leave_out(lv, approver_title(session, college, day.data, teacher_id))


@router.get("/colleges/{ref}/my-leaves", response_model=list[LeaveOut])
def my_leaves(who: MemberDep, session: DbSession) -> list[LeaveOut]:
    """A teacher's own leave requests (last 30 days and later), newest date first."""
    college, member = who
    require_role(member, "teacher")
    data = published_data(session, college)
    rows = session.scalars(
        select(Leave)
        .where(Leave.college_id == college.id, Leave.teacher_id == member.teacher_id,
               Leave.date >= (today() - timedelta(days=30)).isoformat())
        .order_by(Leave.date.desc(), Leave.id.desc())
    )
    waiting = approver_title(session, college, data, member.teacher_id or "")
    return [leave_out(lv, waiting) for lv in rows]


@router.get("/colleges/{ref}/hod", response_model=HodView)
def hod_view(who: MemberDep, session: DbSession) -> HodView:
    """HOD: their department's leave requests (last 30 days and later), waiting ones first."""
    college, head = who
    require_role(head, "hod")
    data = published_data(session, college)
    mine = {t.id for t in (data.teachers if data else []) if t.department_id == head.department_id}
    rows = session.scalars(
        select(Leave).where(Leave.college_id == college.id, Leave.date >= (today() - timedelta(days=30)).isoformat())
        .order_by(Leave.date, Leave.id)
    )
    title = f"HOD ({head.department_id})"
    leaves = sorted((leave_out(lv, title) for lv in rows if lv.teacher_id in mine), key=lambda x: (x.status != "pending", x.date))
    return HodView(department_id=head.department_id, department_name=department_name(data, head.department_id), name=head.name,
                   college_name=college.name, leaves=leaves)


@router.post("/colleges/{ref}/leaves/{leave_id}/decide", response_model=LeaveOut)
def decide_leave(
    ref: str, leave_id: int, body: LeaveDecision, session: DbSession,
    x_admin_key: Annotated[str | None, Header()] = None, x_member_key: Annotated[str | None, Header()] = None,
) -> LeaveOut:
    """Approve or reject a leave request: the HOD of the teacher's department, or the admin on their behalf."""
    college = find_college(session, ref)
    lv = session.get(Leave, leave_id)
    if lv is None or lv.college_id != college.id:
        raise HTTPException(404, "No such leave request.")
    data = published_data(session, college)
    dept = next((t.department_id for t in (data.teachers if data else []) if t.id == lv.teacher_id), None)
    if is_admin(college, x_admin_key):
        by = "Admin"
    else:
        _, head = member_access(ref, session, x_member_key)
        require_role(head, "hod")
        if not can_manage_department(head, dept):
            raise HTTPException(403, f"Only the HOD of {dept or 'this teacher’s department'} can decide this leave.")
        by = f"HOD ({head.department_id})" + (f", {head.name}" if head.name else "")
    if lv.status != "pending":
        raise HTTPException(409, f"This leave is already {lv.status}.")
    lv.status = "approved" if body.action == "approve" else "rejected"
    lv.decided_by, lv.decision_note, lv.decided_at = by, body.note.strip(), now()
    session.commit()
    return leave_out(lv)


# ---------- Admin ----------


@router.get("/colleges/{ref}/cover", response_model=CoverView)
def cover(college: AdminCollegeDep, session: DbSession, on: Annotated[date, Query(alias="date")]) -> CoverView:
    """Admin: who is on leave, the classes that need cover (with ranked substitutes), and every change that day."""
    day = load_day(session, college, on)
    entries = actual(day)
    plain = actual(day, [c for c in day.changes if c.kind == "extra"])  # the day before any cover was arranged
    leaves: list[LeaveCover] = []
    for lv in day.leaves:
        classes: list[AffectedClass] = []
        for e, a, b in classes_of(plain, lv.teacher_id, span(lv)) if lv.status != "rejected" else []:
            periods = range(a, b + 1)
            done = next((c for c in day.changes if c.kind in ("substitute", "cancel") and c.section_id == e.section_id and set(span(c)) & set(periods)), None)
            classes.append(AffectedClass(
                section_id=e.section_id, subject_id=e.subject_id, start_period=a, end_period=b, room_id=e.room_id, batch=e.batch,
                class_kind=e.kind,
                state=("awaiting_approval" if lv.status == "pending" else "needs_cover") if done is None
                else "substitute" if done.kind == "substitute" else "cancelled",
                change_id=done.id if done else None, new_teacher_id=done.new_teacher_id if done else None,
                suggestions=[] if done or lv.status != "approved" else suggest(day, entries, e.section_id, e.subject_id, periods, lv.teacher_id),
            ))
        waiting = approver_title(session, college, day.data, lv.teacher_id)
        leaves.append(LeaveCover(**leave_out(lv, waiting).model_dump(), classes=classes))
    return CoverView(date=on, day=day.day, working_day=day.working, leaves=leaves,
                     changes=[change_out(c) for c in day.changes], check=day_check(day, entries))


@router.delete("/colleges/{ref}/leaves/{leave_id}", status_code=204)
def remove_leave(leave_id: int, college: AdminCollegeDep, session: DbSession) -> None:
    """Admin: remove a leave, and the substitutes or cancellations made for it."""
    lv = session.get(Leave, leave_id)
    if lv is None or lv.college_id != college.id:
        raise HTTPException(404, "No such leave.")
    session.execute(delete(DayChange).where(DayChange.leave_id == lv.id))
    session.delete(lv)
    session.commit()


@router.get("/colleges/{ref}/extra-slots", response_model=list[SlotOption])
def extra_slots(
    college: AdminCollegeDep, session: DbSession, on: Annotated[date, Query(alias="date")],
    section_id: str, teacher_id: str,
) -> list[SlotOption]:
    """Admin: for an extra or makeup class, the periods where the section, the teacher and a suitable room are all free."""
    day = load_day(session, college, on)
    data = day.data
    section = next((s for s in data.sections if s.id == section_id), None)
    if section is None or teacher_id not in {t.id for t in data.teachers}:
        raise HTTPException(400, "Choose a section and a teacher from the list.")
    entries = actual(day)
    uses = {t.id: t.use for t in data.room_types}
    rooms = sorted(
        (r for r in data.rooms if uses.get(r.type) == "lecture" and r.capacity >= section.strength
         and (r.department_id is None or r.department_id == section.department_id)),
        key=lambda r: (r.capacity, r.id),
    )
    t = next(x for x in data.teachers if x.id == teacher_id)
    out: list[SlotOption] = []
    for p in range(1, data.settings.periods_on(day.day) + 1):
        here = [e for e in entries if e.period == p]
        reason = None
        if any(e.section_id == section_id for e in here):
            reason = "The section has a class"
        elif any(e.teacher_id == teacher_id for e in here):
            reason = "The teacher has a class"
        elif on_leave(day, teacher_id, range(p, p + 1)):
            reason = "The teacher is on leave"
        elif unavailable(day, teacher_id, range(p, p + 1)):
            reason = "The teacher is unavailable"
        elif t.max_periods_per_day is not None and load(entries, teacher_id) + 1 > t.max_periods_per_day:
            reason = "The teacher is at their daily maximum"
        taken = {e.room_id for e in here}
        free = [r.id for r in rooms if r.id not in taken]
        if reason is None and not free:
            reason = "No suitable room is free"
        out.append(SlotOption(period=p, ok=reason is None, reason=reason, rooms=free if reason is None else []))
    return out


@router.post("/colleges/{ref}/changes", response_model=ChangeOut, status_code=201)
def add_change(body: ChangeIn, college: AdminCollegeDep, session: DbSession) -> ChangeOut:
    """Admin: assign a substitute, cancel a class, or add an extra class. The day it
    produces is clash-checked before it is saved."""
    check_date(body.date)
    day = load_day(session, college, body.date)
    data = day.data
    periods = periods_of(day, body.start_period, body.end_period or body.start_period)
    if body.section_id not in {s.id for s in data.sections}:
        raise HTTPException(400, f"No section with the code \"{body.section_id}\".")
    linked = next((lv for lv in day.leaves if lv.id == body.leave_id), None)
    if body.leave_id is not None and linked is None:
        raise HTTPException(400, "That leave isn't on this date.")
    if linked is not None and linked.status != "approved":
        raise HTTPException(409, "This leave isn't approved yet. Cover is arranged once the HOD (or the admin) approves it.")

    entries = actual(day)
    replaced: list[DayChange] = []
    if body.kind in ("substitute", "cancel"):
        usual = body.teacher_id  # whose class, when batches share the slot

        def theirs(e: Entry) -> bool:
            return e.section_id == body.section_id and e.period in periods and usual in (None, e.teacher_id)

        # A substitute or cancellation already made for this class is replaced (changing your mind).
        replaced = [c for c in day.changes if c.kind in ("substitute", "cancel") and c.section_id == body.section_id
                    and set(span(c)) & set(periods) and usual in (None, c.teacher_id)]
        # The class as it stands (before any cover it replaces): it must exist in every one of these periods.
        found = [e for e in (actual(day, [c for c in day.changes if c not in replaced]) if replaced else entries) if theirs(e)]
        if len({e.period for e in found}) != len(periods) or len({(e.subject_id, e.teacher_id) for e in found}) != 1:
            raise HTTPException(400, "There's no single class for this section in these periods. Pick the class from the list.")
        e = found[0]
        if body.kind == "substitute":
            new = body.new_teacher_id
            if not new or new not in {t.id for t in data.teachers}:
                raise HTTPException(400, "Choose who will take the class.")
            original = next((c.teacher_id for c in replaced), e.teacher_id)
            if new == original:
                raise HTTPException(400, "Choose someone other than the usual teacher.")
            if on_leave(day, new, periods):
                raise HTTPException(409, "That teacher is on leave then.")
        change = DayChange(
            college_id=college.id, date=body.date.isoformat(), kind=body.kind, section_id=body.section_id,
            subject_id=e.subject_id, start_period=periods.start, end_period=periods.stop - 1,
            teacher_id=next((c.teacher_id for c in replaced), e.teacher_id),
            new_teacher_id=body.new_teacher_id if body.kind == "substitute" else None,
            room_id=e.room_id, class_kind=e.kind, note=body.note.strip(), leave_id=body.leave_id,
        )
        who = change.new_teacher_id
    else:
        assignment = next((a for a in data.assignments if a.section_id == body.section_id and a.subject_id == body.subject_id), None)
        if assignment is None:
            raise HTTPException(400, "Choose a subject this section studies.")
        teacher = body.teacher_id or assignment.teacher_id
        if teacher not in {t.id for t in data.teachers}:
            raise HTTPException(400, "Choose a teacher from the list.")
        if not body.room_id or body.room_id not in {r.id for r in data.rooms}:
            raise HTTPException(400, "Choose a room from the list.")
        if on_leave(day, teacher, periods):
            raise HTTPException(409, "That teacher is on leave then.")
        change = DayChange(
            college_id=college.id, date=body.date.isoformat(), kind="extra", section_id=body.section_id,
            subject_id=assignment.subject_id, start_period=periods.start, end_period=periods.stop - 1,
            teacher_id=teacher, room_id=body.room_id, class_kind="lecture", note=body.note.strip(), leave_id=body.leave_id,
        )
        who = teacher

    after = [c for c in day.changes if c not in replaced] + [change]
    result = actual(day, after)
    report = day_check(day, result)
    if not report.ok:
        first = (report.clashes or report.violations)[0]
        raise HTTPException(409, f"This would break the timetable: {first.message}")
    if who is not None and (limit := over_max(day, result, who)) is not None:
        raise HTTPException(409, f"That would give the teacher more than their daily maximum of {limit} periods.")

    for c in replaced:
        session.delete(c)
    session.add(change)
    session.commit()
    return change_out(change)


@router.delete("/colleges/{ref}/changes/{change_id}", status_code=204)
def remove_change(change_id: int, college: AdminCollegeDep, session: DbSession) -> None:
    """Admin: undo a change."""
    c = session.get(DayChange, change_id)
    if c is None or c.college_id != college.id:
        raise HTTPException(404, "No such change.")
    session.delete(c)
    session.commit()
