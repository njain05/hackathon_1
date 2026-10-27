"""People with a role in one department, each with their own secret link.

Today: the HOD, who approves their department's leave. Built to grow (the roles
work adds the timetable in-charge and teachers): one `members` table, one
header (X-Member-Key), one dependency. The college admin stays separate: the
admin key on `colleges` (AdminCollegeDep) can act for every department.
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from solver import CollegeData

from .colleges import AdminCollegeDep, DbSession, find_college, hash_key, latest
from .db import College, Member, now
from .demo import refuse_if_demo

router = APIRouter(tags=["members"])

ROLE_TEXT = {"hod": "HOD", "incharge": "Timetable in-charge", "teacher": "Teacher"}


def member_access(ref: str, session: DbSession, x_member_key: Annotated[str | None, Header()] = None) -> tuple[College, Member]:
    """FastAPI dependency: the college, and the member whose link this is (403 if unknown or revoked)."""
    college = find_college(session, ref)
    member = x_member_key and session.scalar(
        select(Member).where(Member.college_id == college.id, Member.key_hash == hash_key(x_member_key), Member.revoked_at.is_(None))
    )
    if not member:
        raise HTTPException(403, "This link isn't valid any more. Ask the timetable admin for a new one.")
    return college, member


MemberDep = Annotated[tuple[College, Member], Depends(member_access)]


def require_role(member: Member, *roles: str) -> None:
    if member.role not in roles:
        raise HTTPException(403, f"Only the {' or '.join(ROLE_TEXT.get(r, r) for r in roles)} can do this.")


def can_manage_department(member: Member, department_id: str | None) -> bool:
    return department_id is not None and member.department_id == department_id


def head_of(session: Session, college: College, department_id: str | None) -> Member | None:
    """The department's current HOD, if one has a link."""
    if department_id is None:
        return None
    return session.scalar(
        select(Member).where(
            Member.college_id == college.id, Member.department_id == department_id, Member.role == "hod", Member.revoked_at.is_(None)
        )
    )


def published_data(session: Session, college: College) -> CollegeData | None:
    pub = latest(session, college)
    return CollegeData.model_validate(pub.data) if pub else None


def department_name(data: CollegeData | None, department_id: str) -> str:
    return next((d.name for d in (data.departments if data else []) if d.id == department_id), department_id)


class HeadIn(BaseModel):
    name: str = Field("", max_length=120)


class HeadOut(BaseModel):
    department_id: str
    department_name: str
    name: str
    has_link: bool
    key: str | None = Field(None, description="Only when a new link was just made: shown once")


@router.get("/colleges/{ref}/departments/heads", response_model=list[HeadOut])
def list_heads(college: AdminCollegeDep, session: DbSession) -> list[HeadOut]:
    """Admin: every department of the published timetable and whether its HOD has a link."""
    data = published_data(session, college)
    out = []
    for d in data.departments if data else []:
        head = head_of(session, college, d.id)
        out.append(HeadOut(department_id=d.id, department_name=d.name, name=head.name if head else "", has_link=head is not None))
    return out


@router.post("/colleges/{ref}/departments/{department_id}/hod", response_model=HeadOut)
def make_head(department_id: str, body: HeadIn, college: AdminCollegeDep, session: DbSession) -> HeadOut:
    """Admin: give a department's HOD a new link (shown once). The previous HOD link stops working."""
    refuse_if_demo(session, college, "its HOD")
    data = published_data(session, college)
    if data is None or department_id not in {d.id for d in data.departments}:
        raise HTTPException(404, "No such department in the published timetable.")
    old = head_of(session, college, department_id)
    if old is not None:
        old.revoked_at = now()  # at most one HOD per department
    key = secrets.token_urlsafe(24)
    session.add(Member(college_id=college.id, department_id=department_id, role="hod", name=body.name.strip(), key_hash=hash_key(key)))
    session.commit()
    return HeadOut(department_id=department_id, department_name=department_name(data, department_id),
                   name=body.name.strip(), has_link=True, key=key)


class TeacherLinkOut(BaseModel):
    teacher_id: str
    name: str
    department_id: str
    has_link: bool
    key: str | None = Field(None, description="Only when a new link was just made: shown once")


def teacher_member(session: Session, college: College, teacher_id: str) -> Member | None:
    return session.scalar(
        select(Member).where(
            Member.college_id == college.id, Member.role == "teacher", Member.teacher_id == teacher_id, Member.revoked_at.is_(None)
        )
    )


@router.get("/colleges/{ref}/teachers/links", response_model=list[TeacherLinkOut])
def list_teacher_links(college: AdminCollegeDep, session: DbSession) -> list[TeacherLinkOut]:
    """Admin: every teacher of the published timetable and whether they have a link."""
    data = published_data(session, college)
    return [
        TeacherLinkOut(teacher_id=t.id, name=t.name, department_id=t.department_id,
                       has_link=teacher_member(session, college, t.id) is not None)
        for t in (data.teachers if data else [])
    ]


@router.post("/colleges/{ref}/teachers/{teacher_id}/link", response_model=TeacherLinkOut)
def make_teacher_link(teacher_id: str, college: AdminCollegeDep, session: DbSession) -> TeacherLinkOut:
    """Admin: a teacher's private link to their teacher page (shown once). Their previous link stops working."""
    refuse_if_demo(session, college, "its teachers' sign-ins")
    data = published_data(session, college)
    teacher = next((t for t in (data.teachers if data else []) if t.id == teacher_id), None)
    if teacher is None:
        raise HTTPException(404, "No such teacher in the published timetable.")
    old = teacher_member(session, college, teacher_id)
    if old is not None:
        old.revoked_at = now()
    key = secrets.token_urlsafe(24)
    session.add(Member(college_id=college.id, department_id=teacher.department_id, role="teacher", name=teacher.name,
                       teacher_id=teacher.id, key_hash=hash_key(key)))
    session.commit()
    return TeacherLinkOut(teacher_id=teacher.id, name=teacher.name, department_id=teacher.department_id, has_link=True, key=key)


class MemberView(BaseModel):
    role: str
    name: str
    department_id: str
    department_name: str
    teacher_id: str | None
    college_name: str
    college_code: str


@router.get("/colleges/{ref}/me", response_model=MemberView)
def me(who: MemberDep, session: DbSession) -> MemberView:
    """Whose link this is: role, name and department (used when a link is opened)."""
    college, m = who
    return MemberView(role=m.role, name=m.name, department_id=m.department_id,
                      department_name=department_name(published_data(session, college), m.department_id),
                      teacher_id=m.teacher_id, college_name=college.name, college_code=college.code)
