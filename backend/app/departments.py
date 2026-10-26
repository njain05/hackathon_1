"""Departments run their own part of the setup.

- An HOD (or the Dean) appoints the department's timetable in-charge: a member
  link with role "incharge". A new one replaces the old.
- The HOD and in-charge edit only their department's rows in the shared setup
  draft: its rooms, teachers, sections and subjects, the classes of its sections,
  and open electives whose choices are all its own subjects. The server merges
  their rows into the draft and leaves everything else as it is.
- Review: the in-charge sends the department's data to the HOD; the HOD
  approves it or sends it back with a note. Changing an approved (or sent)
  department's rows puts it back to draft. The Dean generates once every
  department with an HOD is approved (the setup page holds Generate until then).
- Room sharing: department B asks to use one of department A's rooms; A's HOD
  (or the Dean) approves, which adds B to the room's `shared_with` in the draft.
  The solver already lets B's classes and electives use shared rooms.

The Dean (the college's super admin) uses X-Admin-Key; HODs and in-charges use
their X-Member-Key. They see only their own department's people.
"""

import json
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal, cast, get_args

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .colleges import DbSession, check_draft_size, find_college, hash_key
from .db import Base, College, CollegeDraft, Member, as_utc, now

router = APIRouter(prefix="/colleges", tags=["departments"])

# ---------- Tables (created with the others on first use) ----------


ReviewState = Literal["draft", "submitted", "approved", "returned"]
REVIEW_STATES = get_args(ReviewState)


class DepartmentReview(Base):
    # A new table (not the old "department_status"), so live databases need no ALTER.
    __tablename__ = "department_reviews"

    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), primary_key=True)
    department_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    state: Mapped[str] = mapped_column(String(20), default="draft")  # ReviewState
    note: Mapped[str] = mapped_column(String(500), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_by: Mapped[str] = mapped_column(String(120), default="")


class RoomRequest(Base):
    __tablename__ = "room_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), index=True)
    room_id: Mapped[str] = mapped_column(String(80))
    owner_department: Mapped[str] = mapped_column(String(80))
    for_department: Mapped[str] = mapped_column(String(80))
    reason: Mapped[str] = mapped_column(String(500), default="")
    requested_by: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected
    decided_by: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------- Who is asking ----------


@dataclass
class Staff:
    college: College
    member: Member | None  # None = the Dean (admin link)

    @property
    def admin(self) -> bool:
        return self.member is None

    @property
    def name(self) -> str:
        return "Dean" if self.member is None else (self.member.name or self.member.role)

    def runs(self, department_id: str) -> bool:
        """The Dean, or the department's HOD or timetable in-charge."""
        m = self.member
        return m is None or (m.role in ("hod", "incharge") and m.department_id == department_id)

    def heads(self, department_id: str) -> bool:
        m = self.member
        return m is None or (m.role == "hod" and m.department_id == department_id)


def staff_access(
    ref: str,
    session: DbSession,
    x_admin_key: Annotated[str | None, Header()] = None,
    x_member_key: Annotated[str | None, Header()] = None,
) -> Staff:
    college = find_college(session, ref)
    if x_admin_key and secrets.compare_digest(hash_key(x_admin_key), college.admin_key_hash):
        return Staff(college, None)
    if x_member_key:
        member = session.scalar(
            select(Member).where(
                Member.college_id == college.id,
                Member.key_hash == hash_key(x_member_key),
                Member.revoked_at.is_(None),
            )
        )
        if member is not None:
            return Staff(college, member)
    raise HTTPException(403, "This link isn't valid for this college. Open the link you were given, or ask the Dean for a new one.")


StaffDep = Annotated[Staff, Depends(staff_access)]

NOT_YOURS = "Only this department's HOD, its timetable in-charge or the Dean can do this."


def must_run(who: Staff, department_id: str) -> None:
    if not who.runs(department_id):
        raise HTTPException(403, NOT_YOURS)


# ---------- The draft, seen per department ----------

COLLECTIONS = ("rooms", "teachers", "sections", "subjects", "assignments", "elective_groups")
NOUN = {
    "rooms": "room", "teachers": "teacher", "sections": "section", "subjects": "subject",
    "assignments": "class", "elective_groups": "open elective",
}


def load_draft(session: Session, college: College) -> CollegeDraft:
    draft = session.get(CollegeDraft, college.id)
    if draft is None or not isinstance(draft.data, dict):
        raise HTTPException(404, f"{college.name} has no setup saved online yet. The Dean should save it online first.")
    return draft


def departments_of(data: dict[str, Any]) -> dict[str, str]:
    return {d.get("id", ""): d.get("name", "") for d in data.get("departments") or [] if isinstance(d, dict)}


def row_key(collection: str, row: dict[str, Any]) -> str:
    if collection == "assignments":
        return f"{row.get('section_id')}|{row.get('subject_id')}"
    return str(row.get("id", ""))


def owner_of(collection: str, row: dict[str, Any], section_dept: dict[str, str], subject_dept: dict[str, str]) -> str | None:
    """The department a row belongs to, or None if it is shared (Dean only)."""
    if collection in ("rooms", "teachers", "sections", "subjects"):
        return row.get("department_id")
    if collection == "assignments":
        return section_dept.get(str(row.get("section_id")))
    if collection == "elective_groups":
        depts = {subject_dept.get(str(o.get("subject_id"))) for o in row.get("options") or [] if isinstance(o, dict)}
        return depts.pop() if len(depts) == 1 else None  # mixed groups belong to the Dean
    return None


def dept_maps(*datas: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    section_dept: dict[str, str] = {}
    subject_dept: dict[str, str] = {}
    for d in datas:
        for s in d.get("sections") or []:
            section_dept.setdefault(str(s.get("id")), s.get("department_id"))
        for s in d.get("subjects") or []:
            subject_dept.setdefault(str(s.get("id")), s.get("department_id"))
    return section_dept, subject_dept


def owned_rows(data: dict[str, Any], dept: str) -> dict[str, list[dict[str, Any]]]:
    """`dept`'s own rows in each collection, in a stable order (to tell whether they changed)."""
    sec, sub = dept_maps(data)
    return {
        coll: sorted((r for r in data.get(coll) or [] if isinstance(r, dict) and owner_of(coll, r, sec, sub) == dept), key=lambda r: row_key(coll, r))
        for coll in COLLECTIONS
    }


def merge_department(stored: dict[str, Any], incoming: dict[str, Any], dept: str) -> tuple[dict[str, Any], list[str]]:
    """Take `dept`'s rows from `incoming`, keep every other row from `stored`.

    Returns the merged draft and plain-English notes about changes outside the
    department that were ignored.
    """
    merged = json.loads(json.dumps(stored))
    ignored: list[str] = []
    # Ownership is judged on the stored draft first (so a row can't be moved out
    # of another department), then on the incoming one for brand-new rows.
    s_sec, s_sub = dept_maps(stored)
    i_sec, i_sub = dept_maps(incoming, stored)

    for coll in COLLECTIONS:
        old_rows = [r for r in stored.get(coll) or [] if isinstance(r, dict)]
        new_rows = [r for r in incoming.get(coll) or [] if isinstance(r, dict)]
        old_owned = {row_key(coll, r): r for r in old_rows if owner_of(coll, r, s_sec, s_sub) == dept}
        others = [r for r in old_rows if row_key(coll, r) not in old_owned]
        other_keys = {row_key(coll, r) for r in others}
        mine: list[dict[str, Any]] = []
        for r in new_rows:
            key = row_key(coll, r)
            owner = owner_of(coll, r, i_sec, i_sub)
            if key in old_owned and owner != dept:
                mine.append(old_owned[key])  # can't hand a row to another department
                ignored.append(f"{NOUN[coll].capitalize()} {key} can only be moved to another department by the Dean.")
            elif owner == dept:
                if key in other_keys:
                    raise HTTPException(409, f"The code {key} is already used by another department's {NOUN[coll]}. Choose a different code.")
                mine.append(r)
        # Changes to other departments' rows are ignored, but said out loud.
        new_others = {row_key(coll, r): r for r in new_rows if owner_of(coll, r, i_sec, i_sub) != dept and row_key(coll, r) not in old_owned}
        changed = sum(1 for k, r in new_others.items() if k not in other_keys or r != next(o for o in others if row_key(coll, o) == k))
        removed = sum(1 for k in other_keys if k not in new_others)
        if changed or removed:
            ignored.append(f"{changed + removed} change(s) to other departments' {NOUN[coll]}s weren't saved.")
        merged[coll] = others + mine

    for key in ("settings", "room_types", "departments", "name"):
        if key in incoming and incoming.get(key) != stored.get(key):
            ignored.append("Changes to the week, room types or departments weren't saved: only the Dean can change those.")
            break
    return merged, ignored


class DepartmentSetup(BaseModel):
    department_id: str
    department_name: str
    role: Literal["admin", "hod", "incharge"]
    data: dict[str, Any]
    updated_at: datetime


class SaveDepartment(BaseModel):
    data: dict[str, Any]


class SavedDepartment(BaseModel):
    updated_at: datetime
    ignored: list[str] = []
    reopened: bool = Field(False, description="The department was approved or waiting for the HOD; this change put it back to draft.")


def role_of(who: Staff) -> Literal["admin", "hod", "incharge"]:
    if who.member is None:
        return "admin"
    return "hod" if who.member.role == "hod" else "incharge"


@router.get("/{ref}/departments/{department_id}/setup", response_model=DepartmentSetup)
def get_department_setup(department_id: str, who: StaffDep, session: DbSession) -> DepartmentSetup:
    """The whole setup (to show other departments' rooms and teachers), for editing one department."""
    must_run(who, department_id)
    draft = load_draft(session, who.college)
    names = departments_of(draft.data)
    if department_id not in names:
        raise HTTPException(404, f'There is no department "{department_id}" in the setup.')
    return DepartmentSetup(
        department_id=department_id, department_name=names[department_id] or department_id,
        role=role_of(who), data=draft.data, updated_at=as_utc(draft.updated_at),
    )


@router.put("/{ref}/departments/{department_id}/setup", response_model=SavedDepartment)
def save_department_setup(department_id: str, body: SaveDepartment, who: StaffDep, session: DbSession) -> SavedDepartment:
    """Save one department's rows into the shared setup. Everything else stays as it is."""
    must_run(who, department_id)
    check_draft_size(body.data)
    draft = load_draft(session, who.college)
    if department_id not in departments_of(draft.data):
        raise HTTPException(404, f'There is no department "{department_id}" in the setup.')
    merged, ignored = merge_department(draft.data, body.data, department_id)
    reopened = False
    # The HOD approved this data (or is about to): changing it needs a fresh look.
    # The Dean's own changes don't, as the Dean has the last word anyway.
    if not who.admin and owned_rows(merged, department_id) != owned_rows(draft.data, department_id):
        r = session.get(DepartmentReview, (who.college.id, department_id))
        if r is not None and r.state in ("submitted", "approved"):
            set_state(r, "draft", who, "Changed after it was sent to the HOD.")
            reopened = True
    draft.data, draft.updated_at = merged, now()
    session.commit()
    return SavedDepartment(updated_at=as_utc(draft.updated_at), ignored=list(dict.fromkeys(ignored)), reopened=reopened)


# ---------- Timetable in-charge ----------


class InchargeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    teacher_id: str | None = Field(None, max_length=80)


class InchargeOut(BaseModel):
    department_id: str
    name: str | None
    since: datetime | None = None
    key: str | None = Field(None, description="Only when a new link is made. Shown once.")


def current_incharge(session: Session, college: College, department_id: str) -> Member | None:
    return session.scalar(
        select(Member).where(
            Member.college_id == college.id, Member.department_id == department_id,
            Member.role == "incharge", Member.revoked_at.is_(None),
        )
    )


@router.get("/{ref}/departments/{department_id}/incharge", response_model=InchargeOut)
def get_incharge(department_id: str, who: StaffDep, session: DbSession) -> InchargeOut:
    must_run(who, department_id)
    m = current_incharge(session, who.college, department_id)
    return InchargeOut(department_id=department_id, name=m.name if m else None, since=as_utc(m.created_at) if m else None)


@router.post("/{ref}/departments/{department_id}/incharge", response_model=InchargeOut)
def make_incharge(department_id: str, body: InchargeIn, who: StaffDep, session: DbSession) -> InchargeOut:
    """HOD or Dean: a new timetable in-charge link for the department. The old link stops working."""
    if not who.heads(department_id):
        raise HTTPException(403, "Only this department's HOD or the Dean can choose its timetable in-charge.")
    draft = load_draft(session, who.college)
    if department_id not in departments_of(draft.data):
        raise HTTPException(404, f'There is no department "{department_id}" in the setup.')
    old = current_incharge(session, who.college, department_id)
    if old is not None:
        old.revoked_at = now()
    key = secrets.token_urlsafe(24)
    m = Member(
        college_id=who.college.id, department_id=department_id, role="incharge",
        name=body.name.strip(), teacher_id=body.teacher_id, key_hash=hash_key(key),
    )
    session.add(m)
    session.commit()
    return InchargeOut(department_id=department_id, name=m.name, since=as_utc(m.created_at), key=key)


# ---------- Review: in-charge sends, HOD approves, Dean generates ----------


class DepartmentState(BaseModel):
    department_id: str
    department_name: str
    state: ReviewState
    note: str = Field("", description="The HOD's note when sending the data back (own department only).")
    updated_at: datetime | None
    updated_by: str = Field("", description="Who last changed the state (own department only).")
    hod: str | None = Field(None, description="Own department only, unless the Dean is asking.")
    incharge: str | None = Field(None, description="Own department only, unless the Dean is asking.")
    needs_approval: bool = Field(description="It has an HOD, so the Dean waits for the HOD's approval before generating.")


class SubmitIn(BaseModel):
    note: str = Field("", max_length=500)


class ReviewIn(BaseModel):
    approve: bool
    note: str = Field("", max_length=500)


def review_of(session: Session, college: College, department_id: str) -> DepartmentReview:
    r = session.get(DepartmentReview, (college.id, department_id))
    if r is None:
        r = DepartmentReview(college_id=college.id, department_id=department_id, state="draft", note="", updated_by="")
        session.add(r)
    return r


def set_state(r: DepartmentReview, state: ReviewState, who: Staff, note: str = "") -> None:
    r.state, r.note, r.updated_at, r.updated_by = state, note.strip(), now(), who.name


def department_people(session: Session, college: College) -> list[Member]:
    return list(session.scalars(
        select(Member).where(Member.college_id == college.id, Member.revoked_at.is_(None), Member.role.in_(("hod", "incharge")))
    ).all())


def state_out(dept: str, name: str, r: DepartmentReview | None, people: list[Member], who: Staff) -> DepartmentState:
    """An HOD or in-charge sees other departments' progress, but not their people or notes."""
    own = who.runs(dept)

    def person(role: str) -> str | None:
        return next((p.name for p in people if p.department_id == dept and p.role == role), None)

    return DepartmentState(
        department_id=dept, department_name=name or dept,
        state=cast(ReviewState, r.state) if r and r.state in REVIEW_STATES else "draft",
        note=(r.note if r else "") if own else "",
        updated_at=as_utc(r.updated_at) if r else None,
        updated_by=(r.updated_by if r else "") if own else "",
        hod=person("hod") if own else None,
        incharge=person("incharge") if own else None,
        needs_approval=any(p.department_id == dept and p.role == "hod" for p in people),
    )


def checked_department(session: Session, who: Staff, department_id: str) -> str:
    names = departments_of(load_draft(session, who.college).data)
    if department_id not in names:
        raise HTTPException(404, f'There is no department "{department_id}" in the setup.')
    return names[department_id]


@router.get("/{ref}/departments/status", response_model=list[DepartmentState])
def department_status(who: StaffDep, session: DbSession) -> list[DepartmentState]:
    """Every department's review state. The Dean sees who runs each one; an HOD or in-charge only their own."""
    if who.member is not None and who.member.role not in ("hod", "incharge"):
        raise HTTPException(403, NOT_YOURS)
    draft = load_draft(session, who.college)
    rows = {r.department_id: r for r in session.scalars(select(DepartmentReview).where(DepartmentReview.college_id == who.college.id))}
    people = department_people(session, who.college)
    return [state_out(dept, name, rows.get(dept), people, who) for dept, name in departments_of(draft.data).items()]


@router.post("/{ref}/departments/{department_id}/submit", response_model=DepartmentState)
def submit_department(department_id: str, body: SubmitIn, who: StaffDep, session: DbSession) -> DepartmentState:
    """The in-charge (or HOD) sends the department's data to the HOD for approval."""
    must_run(who, department_id)
    name = checked_department(session, who, department_id)
    r = review_of(session, who.college, department_id)
    if r.state == "approved":
        raise HTTPException(409, f"{name or department_id} is already approved by the HOD.")
    if r.state == "submitted":
        raise HTTPException(409, f"{name or department_id} is already waiting for the HOD's approval.")
    set_state(r, "submitted", who, body.note)
    session.commit()
    return state_out(department_id, name, r, department_people(session, who.college), who)


@router.post("/{ref}/departments/{department_id}/review", response_model=DepartmentState)
def review_department(department_id: str, body: ReviewIn, who: StaffDep, session: DbSession) -> DepartmentState:
    """The department's HOD (or the Dean) approves its data, or sends it back with a note saying what to fix."""
    if not who.heads(department_id):
        raise HTTPException(403, "Only this department's HOD or the Dean can approve its data.")
    name = checked_department(session, who, department_id)
    r = review_of(session, who.college, department_id)
    if body.approve:
        if r.state == "approved":
            raise HTTPException(409, f"{name or department_id} is already approved.")
        set_state(r, "approved", who, body.note)
    else:
        if r.state not in ("submitted", "approved"):
            raise HTTPException(409, f"{name or department_id} hasn't been sent for approval, so there is nothing to send back.")
        if not body.note.strip():
            raise HTTPException(422, "Write a short note saying what to fix, so the in-charge knows.")
        set_state(r, "returned", who, body.note)
    session.commit()
    return state_out(department_id, name, r, department_people(session, who.college), who)


# ---------- Room sharing ----------


class RoomRequestIn(BaseModel):
    room_id: str = Field(min_length=1, max_length=80)
    for_department: str = Field(min_length=1, max_length=80)
    reason: str = Field("", max_length=500)


class RoomRequestOut(BaseModel):
    id: int
    room_id: str
    room_name: str
    owner_department: str
    for_department: str
    reason: str
    requested_by: str
    status: str
    decided_by: str
    note: str
    created_at: datetime
    decided_at: datetime | None


class DecisionIn(BaseModel):
    approve: bool
    note: str = Field("", max_length=500)


def room_in(data: dict[str, Any], room_id: str) -> dict[str, Any] | None:
    return next((r for r in data.get("rooms") or [] if isinstance(r, dict) and r.get("id") == room_id), None)


def request_out(r: RoomRequest, data: dict[str, Any]) -> RoomRequestOut:
    room = room_in(data, r.room_id) or {}
    return RoomRequestOut(
        id=r.id, room_id=r.room_id, room_name=room.get("name") or r.room_id, owner_department=r.owner_department,
        for_department=r.for_department, reason=r.reason, requested_by=r.requested_by, status=r.status,
        decided_by=r.decided_by, note=r.note, created_at=as_utc(r.created_at),
        decided_at=as_utc(r.decided_at) if r.decided_at else None,
    )


@router.post("/{ref}/room-requests", response_model=RoomRequestOut, status_code=201)
def request_room(body: RoomRequestIn, who: StaffDep, session: DbSession) -> RoomRequestOut:
    """A department asks to use another department's room."""
    must_run(who, body.for_department)
    data = load_draft(session, who.college).data
    room = room_in(data, body.room_id)
    if room is None:
        raise HTTPException(404, f'There is no room "{body.room_id}" in the setup.')
    owner = room.get("department_id")
    if not owner:
        raise HTTPException(409, f"{room.get('name') or body.room_id} is already shared by every department. No approval needed.")
    if owner == body.for_department:
        raise HTTPException(409, f"{room.get('name') or body.room_id} already belongs to {body.for_department}.")
    if body.for_department in (room.get("shared_with") or []):
        raise HTTPException(409, f"{room.get('name') or body.room_id} is already shared with {body.for_department}.")
    pending = session.scalar(
        select(RoomRequest).where(
            RoomRequest.college_id == who.college.id, RoomRequest.room_id == body.room_id,
            RoomRequest.for_department == body.for_department, RoomRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(409, f"{body.for_department} has already asked for {room.get('name') or body.room_id}. Waiting for {owner}'s HOD.")
    r = RoomRequest(
        college_id=who.college.id, room_id=body.room_id, owner_department=owner, for_department=body.for_department,
        reason=body.reason.strip(), requested_by=who.name,
    )
    session.add(r)
    session.commit()
    return request_out(r, data)


@router.get("/{ref}/room-requests", response_model=list[RoomRequestOut])
def list_room_requests(who: StaffDep, session: DbSession) -> list[RoomRequestOut]:
    """Dean: all. HOD / in-charge: requests for their department's rooms and the ones it sent."""
    data = load_draft(session, who.college).data
    q = select(RoomRequest).where(RoomRequest.college_id == who.college.id)
    if who.member is not None:
        if who.member.role not in ("hod", "incharge"):
            raise HTTPException(403, NOT_YOURS)
        d = who.member.department_id
        q = q.where((RoomRequest.owner_department == d) | (RoomRequest.for_department == d))
    rows = session.scalars(q.order_by(RoomRequest.created_at.desc())).all()
    return [request_out(r, data) for r in rows]


@router.post("/{ref}/room-requests/{request_id}/decide", response_model=RoomRequestOut)
def decide_room_request(request_id: int, body: DecisionIn, who: StaffDep, session: DbSession) -> RoomRequestOut:
    """The room's HOD (or the Dean) approves or rejects. Approving shares the room in the setup."""
    r = session.get(RoomRequest, request_id)
    if r is None or r.college_id != who.college.id:
        raise HTTPException(404, "No such room request.")
    if not who.heads(r.owner_department):
        raise HTTPException(403, f"Only {r.owner_department}'s HOD or the Dean can decide on its rooms.")
    if r.status != "pending":
        raise HTTPException(409, f"This request was already {r.status}.")
    draft = load_draft(session, who.college)
    if body.approve:
        data = json.loads(json.dumps(draft.data))
        room = room_in(data, r.room_id)
        if room is None:
            raise HTTPException(409, f"Room {r.room_id} is no longer in the setup.")
        shared = [d for d in room.get("shared_with") or [] if d != r.for_department]
        room["shared_with"] = [*shared, r.for_department]
        draft.data, draft.updated_at = data, now()
    r.status = "approved" if body.approve else "rejected"
    r.decided_by, r.note, r.decided_at = who.name, body.note.strip(), now()
    session.commit()
    return request_out(r, draft.data)
