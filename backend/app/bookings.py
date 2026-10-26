"""Hall booking with digital approval: this replaces the paper letter.

- Organisers (no login) pick an event room (a room type used for events) and a
  date, see only the free periods, and send a request. They get a tracking link.
- The request moves through the admin's approval chain (e.g. HOD → Dean), one
  step at a time. Each step has its own secret approver link; the admin link may
  act for any step.
- The backend owns the clash rule: a period is free only if the published
  timetable has no class in the room and no approved or pending booking holds
  it. Every approval checks again, so two approved bookings never overlap.
"""

import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .colleges import AdminCollegeDep, DbSession, find_college, hash_key, latest
from .db import ApprovalStep, Booking, BookingAction, College, as_utc, now

router = APIRouter(tags=["bookings"])

ACTIVE = ("pending", "approved")  # these hold their periods
MAX_STEPS = 5
MAX_DAYS_AHEAD = 366


# ---------- Models ----------


class NewBooking(BaseModel):
    room_id: str
    date: date
    start_period: int = Field(ge=1)
    end_period: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    purpose: str = Field("", max_length=2000)
    attendees: int = Field(ge=1, le=100_000)
    organiser: str = Field(min_length=1, max_length=120, description="Organiser's name")
    club: str = Field(min_length=1, max_length=120, description="Club, society or department")
    contact: str = Field(min_length=3, max_length=120, description="Phone or email")


class StepState(BaseModel):
    title: str
    state: Literal["approved", "rejected", "waiting", "later"]


class ActionOut(BaseModel):
    action: str
    step_title: str
    by: str
    note: str
    at: datetime


class BookingOut(BaseModel):
    id: int
    token: str
    room_id: str
    room_name: str
    date: date
    day: str
    start_period: int
    end_period: int
    title: str
    purpose: str
    attendees: int
    organiser: str
    club: str
    contact: str
    status: str
    waiting_for: str | None
    waiting_since: datetime | None
    steps: list[StepState]
    history: list[ActionOut]
    created_at: datetime
    college_name: str
    college_code: str


class EventOut(BaseModel):
    """What everyone may see on the events calendar: no names or phone numbers."""

    id: int
    title: str
    club: str
    room_id: str
    room_name: str
    date: date
    start_period: int
    end_period: int


class PeriodSlot(BaseModel):
    period: int
    free: bool
    reason: Literal["class", "booked", "requested"] | None = None


class Availability(BaseModel):
    room_id: str
    date: date
    day: str | None = Field(description="The college's name for this weekday, or None if it isn't a working day")
    periods: list[PeriodSlot]


class StepIn(BaseModel):
    id: int | None = Field(None, description="Keep an existing step (and its link); leave out for a new one")
    title: str = Field(min_length=1, max_length=80)


class StepOut(BaseModel):
    id: int | None
    title: str
    position: int
    key: str | None = Field(None, description="Only when the link is new: shown once")


class Decision(BaseModel):
    action: Literal["approve", "reject"]
    note: str = Field("", max_length=1000)
    by: str = Field("", max_length=80, description="Approver's name, optional")


class ApprovalsView(BaseModel):
    you: StepOut | None = Field(description="Your step, or None for the admin (who may act for any step)")
    steps: list[StepOut]
    bookings: list[BookingOut]


# ---------- Helpers ----------


@dataclass
class Step:
    id: int | None  # None: the default single "Admin" step, before the admin sets a chain
    title: str
    position: int


def chain(session: Session, college: College) -> list[Step]:
    rows = session.scalars(
        select(ApprovalStep).where(ApprovalStep.college_id == college.id).order_by(ApprovalStep.position)
    ).all()
    return [Step(r.id, r.title, i) for i, r in enumerate(rows)] or [Step(None, "Admin", 0)]


def published(session: Session, college: College) -> dict[str, Any]:
    pub = latest(session, college)
    if pub is None:
        raise HTTPException(409, f"{college.name} hasn't published its timetable yet, so halls can't be booked. Try again later.")
    return {"data": pub.data, "entries": pub.result.get("entries", [])}


def event_rooms(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    uses = {t["id"]: t["use"] for t in data.get("room_types", [])}
    return {r["id"]: r for r in data.get("rooms", []) if uses.get(r["type"]) == "event"}


def working_day(data: dict[str, Any], d: date) -> str | None:
    """The college's own name for this date's weekday ("Monday", "Mon"…), if it's a working day."""
    weekday = d.strftime("%A").lower()
    return next((x for x in data["settings"]["days"] if x.strip().lower()[:3] == weekday[:3]), None)


def busy_periods(
    session: Session, college: College, pub: dict[str, Any], room_id: str, d: date,
    *, ignore: int | None = None, approved_only: bool = False,
) -> dict[int, str]:
    """Period → why it's taken: a class in the published timetable, or another booking."""
    busy: dict[int, str] = {}
    day = working_day(pub["data"], d)
    if day is not None:
        for e in pub["entries"]:
            if e["room_id"] == room_id and e["day"] == day:
                busy[e["period"]] = "class"
    statuses = ("approved",) if approved_only else ACTIVE
    for b in session.scalars(
        select(Booking).where(
            Booking.college_id == college.id, Booking.room_id == room_id,
            Booking.date == d.isoformat(), Booking.status.in_(statuses),
        )
    ):
        if b.id == ignore:
            continue
        for p in range(b.start_period, b.end_period + 1):
            busy.setdefault(p, "booked" if b.status == "approved" else "requested")
    return busy


REASON = {"class": "has a class", "booked": "is already booked", "requested": "is requested by another organiser"}


def lock(session: Session, college: College) -> None:
    """Serialise booking changes for one college, so two requests can't both take a slot (Postgres)."""
    session.scalar(select(College.id).where(College.id == college.id).with_for_update())


def to_out(session: Session, college: College, b: Booking, pub: dict[str, Any] | None = None) -> BookingOut:
    steps = chain(session, college)
    current = min(b.step, len(steps) - 1)
    actions = session.scalars(select(BookingAction).where(BookingAction.booking_id == b.id).order_by(BookingAction.at, BookingAction.id)).all()
    states: list[StepState] = []
    for s in steps:
        if b.status == "approved" or (b.status != "rejected" and s.position < current):
            state = "approved"
        elif b.status == "rejected" and s.position == current:
            state = "rejected"
        elif b.status == "pending" and s.position == current:
            state = "waiting"
        else:
            state = "later"
        states.append(StepState(title=s.title, state=state))
    pending = b.status == "pending"
    rooms = event_rooms(pub["data"]) if pub else {}
    d = date.fromisoformat(b.date)
    return BookingOut(
        id=b.id, token=b.token, room_id=b.room_id, room_name=rooms.get(b.room_id, {}).get("name", b.room_id),
        date=d, day=d.strftime("%A"), start_period=b.start_period, end_period=b.end_period,
        title=b.title, purpose=b.purpose, attendees=b.attendees, organiser=b.organiser, club=b.club, contact=b.contact,
        status=b.status,
        waiting_for=steps[current].title if pending else None,
        waiting_since=as_utc(actions[-1].at if actions else b.created_at) if pending else None,
        steps=states,
        history=[ActionOut(action=a.action, step_title=a.step_title, by=a.by, note=a.note, at=as_utc(a.at)) for a in actions],
        created_at=as_utc(b.created_at), college_name=college.name, college_code=college.code,
    )


def latest_pub(session: Session, college: College) -> dict[str, Any] | None:
    pub = latest(session, college)
    return {"data": pub.data, "entries": pub.result.get("entries", [])} if pub else None


@dataclass
class Actor:
    step: ApprovalStep | None  # None = the admin


def approver(
    ref: str,
    session: DbSession,
    x_admin_key: Annotated[str | None, Header()] = None,
    x_approver_key: Annotated[str | None, Header()] = None,
) -> tuple[College, Actor]:
    """FastAPI dependency: the college, and who is acting (the admin, or one approval step)."""
    college = find_college(session, ref)
    if x_admin_key and secrets.compare_digest(hash_key(x_admin_key), college.admin_key_hash):
        return college, Actor(None)
    if x_approver_key:
        step = session.scalar(
            select(ApprovalStep).where(ApprovalStep.college_id == college.id, ApprovalStep.key_hash == hash_key(x_approver_key))
        )
        if step is not None:
            return college, Actor(step)
    raise HTTPException(403, "This approval link isn't valid any more. Ask the admin for a new one.")


ApproverDep = Annotated[tuple[College, Actor], Depends(approver)]


def today() -> date:
    # The server runs in UTC; allow "yesterday" so colleges behind UTC can still book their today.
    return (datetime.now(UTC) - timedelta(days=1)).date()


# ---------- Organisers (public) ----------


@router.get("/colleges/{ref}/availability", response_model=Availability)
def availability(ref: str, session: DbSession, room_id: str, on: Annotated[date, Query(alias="date")]) -> Availability:
    """Which periods of this event room are free on this date."""
    college = find_college(session, ref)
    pub = published(session, college)
    if room_id not in event_rooms(pub["data"]):
        raise HTTPException(404, f"\"{room_id}\" isn't a hall or room that can be booked for events.")
    busy = busy_periods(session, college, pub, room_id, on)
    n = pub["data"]["settings"]["periods_per_day"]
    return Availability(
        room_id=room_id, date=on, day=working_day(pub["data"], on),
        periods=[PeriodSlot(period=p, free=p not in busy, reason=busy.get(p)) for p in range(1, n + 1)],  # type: ignore[arg-type]
    )


@router.post("/colleges/{ref}/bookings", response_model=BookingOut, status_code=201)
def request_booking(ref: str, body: NewBooking, session: DbSession) -> BookingOut:
    """Send a booking request. It starts at the first approval step."""
    college = find_college(session, ref)
    lock(session, college)
    pub = published(session, college)
    rooms = event_rooms(pub["data"])
    room = rooms.get(body.room_id)
    if room is None:
        raise HTTPException(400, f"\"{body.room_id}\" can't be booked. Choose one of the halls in the list.")
    if body.date < today():
        raise HTTPException(400, "That date has passed. Choose today or a later date.")
    if body.date > today() + timedelta(days=MAX_DAYS_AHEAD):
        raise HTTPException(400, "Bookings open up to a year ahead. Choose an earlier date.")
    n = pub["data"]["settings"]["periods_per_day"]
    if body.end_period < body.start_period or body.end_period > n:
        raise HTTPException(400, f"Choose periods between 1 and {n}, with the last one after the first.")
    if body.attendees > room["capacity"]:
        raise HTTPException(
            400,
            f"{room['name']} seats {room['capacity']}, but you expect {body.attendees}. "
            "Choose a bigger hall or lower the number of attendees.",
        )
    busy = busy_periods(session, college, pub, body.room_id, body.date)
    for p in range(body.start_period, body.end_period + 1):
        if p in busy:
            raise HTTPException(409, f"Period {p} in {room['name']} {REASON[busy[p]]} on that day. Pick free periods.")
    b = Booking(
        college_id=college.id, token=secrets.token_urlsafe(16), room_id=body.room_id, date=body.date.isoformat(),
        start_period=body.start_period, end_period=body.end_period, title=body.title.strip(), purpose=body.purpose.strip(),
        attendees=body.attendees, organiser=body.organiser.strip(), club=body.club.strip(), contact=body.contact.strip(),
        status="pending", step=0,
    )
    session.add(b)
    session.commit()
    return to_out(session, college, b, pub)


def by_token(session: Session, token: str) -> tuple[Booking, College]:
    b = session.scalar(select(Booking).where(Booking.token == token))
    if b is None:
        raise HTTPException(404, "No booking request with this tracking link. Check the link and try again.")
    college = session.get(College, b.college_id)
    assert college is not None
    return b, college


@router.get("/bookings/{token}", response_model=BookingOut)
def track(token: str, session: DbSession) -> BookingOut:
    """The organiser's tracking page: exactly where the request is."""
    b, college = by_token(session, token)
    return to_out(session, college, b, latest_pub(session, college))


@router.post("/bookings/{token}/cancel", response_model=BookingOut)
def cancel(token: str, session: DbSession) -> BookingOut:
    """The organiser withdraws the request (or cancels the event). The periods become free again."""
    b, college = by_token(session, token)
    if b.status not in ACTIVE:
        raise HTTPException(409, f"This request is already {b.status}.")
    b.status, b.updated_at = "cancelled", now()
    session.add(BookingAction(booking_id=b.id, action="cancelled", step_title="Organiser", by=b.organiser))
    session.commit()
    return to_out(session, college, b, latest_pub(session, college))


@router.get("/colleges/{ref}/events", response_model=list[EventOut])
def events(ref: str, session: DbSession, since: Annotated[date | None, Query(alias="from")] = None) -> list[EventOut]:
    """The college events calendar: approved bookings from a date on (default: today)."""
    college = find_college(session, ref)
    pub = latest_pub(session, college)
    rooms = event_rooms(pub["data"]) if pub else {}
    rows = session.scalars(
        select(Booking)
        .where(Booking.college_id == college.id, Booking.status == "approved", Booking.date >= (since or today()).isoformat())
        .order_by(Booking.date, Booking.start_period)
        .limit(500)
    )
    return [
        EventOut(
            id=b.id, title=b.title, club=b.club, room_id=b.room_id, room_name=rooms.get(b.room_id, {}).get("name", b.room_id),
            date=date.fromisoformat(b.date), start_period=b.start_period, end_period=b.end_period,
        )
        for b in rows
    ]


# ---------- Approvers ----------


def step_out(s: Step, key: str | None = None) -> StepOut:
    return StepOut(id=s.id, title=s.title, position=s.position, key=key)


@router.get("/colleges/{ref}/approvals", response_model=ApprovalsView)
def approvals(who: ApproverDep, session: DbSession) -> ApprovalsView:
    """For approvers and the admin: every request, newest first, with the chain."""
    college, actor = who
    steps = chain(session, college)
    pub = latest_pub(session, college)
    rows = session.scalars(select(Booking).where(Booking.college_id == college.id).order_by(Booking.created_at.desc()).limit(500))
    you = None
    if actor.step is not None:
        you = next(step_out(s) for s in steps if s.id == actor.step.id)
    return ApprovalsView(you=you, steps=[step_out(s) for s in steps], bookings=[to_out(session, college, b, pub) for b in rows])


@router.post("/colleges/{ref}/approvals/{booking_id}", response_model=BookingOut)
def decide(booking_id: int, body: Decision, who: ApproverDep, session: DbSession) -> BookingOut:
    """Approve or reject at the step the request is waiting for. Approving checks for clashes again."""
    college, actor = who
    lock(session, college)
    b = session.get(Booking, booking_id)
    if b is None or b.college_id != college.id:
        raise HTTPException(404, "No such booking request.")
    if b.status != "pending":
        raise HTTPException(409, f"This request is already {b.status}.")
    steps = chain(session, college)
    current = steps[min(b.step, len(steps) - 1)]
    if actor.step is not None and actor.step.id != current.id:
        raise HTTPException(409, f"This request is waiting for {current.title}, not {actor.step.title}. It moves to you after them.")

    name = body.by.strip()
    by = (current.title if actor.step else f"Admin, for {current.title}") + (f" ({name})" if name else "")
    if body.action == "approve":
        pub = published(session, college)
        clash = busy_periods(session, college, pub, b.room_id, date.fromisoformat(b.date), ignore=b.id, approved_only=True)
        taken = [p for p in range(b.start_period, b.end_period + 1) if p in clash]
        if taken:
            raise HTTPException(
                409,
                f"Period {taken[0]} in this room {REASON[clash[taken[0]]]} on that day, so this request can't be approved. "
                "Reject it with a note so the organiser can pick another time.",
            )
        last = current.position == len(steps) - 1
        b.status = "approved" if last else "pending"
        b.step = current.position if last else current.position + 1
        action = "approved"
    else:
        b.status = "rejected"
        action = "rejected"
    b.updated_at = now()
    session.add(BookingAction(booking_id=b.id, action=action, step_title=current.title, by=by, note=body.note.strip()))
    session.commit()
    return to_out(session, college, b, latest_pub(session, college))


@router.get("/colleges/{ref}/approval-steps", response_model=list[StepOut])
def get_steps(college: AdminCollegeDep, session: DbSession) -> list[StepOut]:
    """Admin: the approval chain. Links aren't shown again; make a new one if it's lost."""
    return [step_out(s) for s in chain(session, college)]


@router.put("/colleges/{ref}/approval-steps", response_model=list[StepOut])
def set_steps(body: list[StepIn], college: AdminCollegeDep, session: DbSession) -> list[StepOut]:
    """Admin: set the chain, in order (e.g. HOD, then Dean). New steps get a secret link, shown once."""
    if not 1 <= len(body) <= MAX_STEPS:
        raise HTTPException(400, f"Add between 1 and {MAX_STEPS} approval steps.")
    existing = {s.id: s for s in session.scalars(select(ApprovalStep).where(ApprovalStep.college_id == college.id))}
    keep = {s.id for s in body if s.id is not None}
    if keep - existing.keys():
        raise HTTPException(400, "One of these steps no longer exists. Reload the page and try again.")
    for sid, row in existing.items():
        if sid not in keep:
            session.delete(row)
    out: list[StepOut] = []
    for i, s in enumerate(body):
        key = None
        if s.id is None:
            key = secrets.token_urlsafe(24)
            row = ApprovalStep(college_id=college.id, position=i, title=s.title.strip(), key_hash=hash_key(key))
            session.add(row)
            session.flush()
        else:
            row = existing[s.id]
            row.position, row.title = i, s.title.strip()
        out.append(StepOut(id=row.id, title=row.title, position=i, key=key))
    session.commit()
    return out


@router.post("/colleges/{ref}/approval-steps/{step_id}/new-link", response_model=StepOut)
def new_link(step_id: int, college: AdminCollegeDep, session: DbSession) -> StepOut:
    """Admin: a new secret link for one approver. The old link stops working."""
    row = session.get(ApprovalStep, step_id)
    if row is None or row.college_id != college.id:
        raise HTTPException(404, "No such approval step.")
    key = secrets.token_urlsafe(24)
    row.key_hash = hash_key(key)
    session.commit()
    return StepOut(id=row.id, title=row.title, position=row.position, key=key)

