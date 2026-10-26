"""Save and share: one college, many users, no login.

Creating a college returns a secret admin key (shown once, kept by the admin as
their admin link) plus a public share link and short code. Every write needs the
key in the X-Admin-Key header. Students and teachers only read the published
timetable, by slug or code.
"""

import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from solver import CollegeData, SolveResult, check_timetable

from .db import College, CollegeDraft, PublishedTimetable, as_utc, get_session, now

router = APIRouter(prefix="/colleges", tags=["colleges"])

DbSession = Annotated[Session, Depends(get_session)]

MAX_DRAFT_CHARS = 5_000_000
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L: easy to read out and type
CODE_LENGTH = 6
BAD_KEY = "This admin link isn't valid for this college. Open the admin link you saved when you created it."


# ---------- Models ----------


class NewCollege(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    data: dict[str, Any] | None = Field(None, description="Setup draft to save straight away (may be incomplete)")


class CollegeInfo(BaseModel):
    """What anyone with the share link may see about a college."""

    name: str
    slug: str
    code: str
    published_version: int | None = None
    published_at: datetime | None = None


class CollegeCreated(CollegeInfo):
    admin_key: str = Field(description="Shown once. Only its hash is stored.")


class AdminCollege(CollegeInfo):
    data: dict[str, Any] | None = None
    data_updated_at: datetime | None = None


class SavedDraft(BaseModel):
    updated_at: datetime


class PublishRequest(BaseModel):
    data: CollegeData
    result: SolveResult


class Published(BaseModel):
    version: int
    published_at: datetime


class PublicTimetable(CollegeInfo):
    version: int
    data: CollegeData
    result: SolveResult


# ---------- Helpers ----------


def hash_key(key: str) -> str:
    # The key is 32 random bytes, so a plain SHA-256 can't be guessed backwards.
    return hashlib.sha256(key.encode()).hexdigest()


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50].strip("-") or "college"
    # Keep slugs from looking like a short code (codes are looked up first).
    return f"{slug}-college" if re.fullmatch(r"[a-z0-9]{%d}" % CODE_LENGTH, slug) else slug


def unique_slug(session: Session, name: str) -> str:
    base = slugify(name)
    slug, n = base, 1
    while session.scalar(select(College.id).where(College.slug == slug)) is not None:
        n += 1
        slug = f"{base}-{n}"
    return slug


def unique_code(session: Session) -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if session.scalar(select(College.id).where(College.code == code)) is None:
            return code


def latest(session: Session, college: College) -> PublishedTimetable | None:
    return session.scalars(
        select(PublishedTimetable)
        .where(PublishedTimetable.college_id == college.id)
        .order_by(PublishedTimetable.version.desc())
        .limit(1)
    ).first()


def info(session: Session, college: College) -> dict[str, Any]:
    pub = latest(session, college)
    return {
        "name": college.name,
        "slug": college.slug,
        "code": college.code,
        "published_version": pub.version if pub else None,
        "published_at": as_utc(pub.published_at) if pub else None,
    }


def check_draft_size(data: dict[str, Any]) -> None:
    if len(json.dumps(data)) > MAX_DRAFT_CHARS:
        raise HTTPException(413, "This setup is too large to save. Remove unused rows and try again.")


def find_college(session: Session, ref: str) -> College:
    """Look a college up by its short code (any case) or its share-link slug."""
    ref = ref.strip()
    college = session.scalars(
        select(College).where(or_(College.code == ref.upper(), College.slug == ref.lower()))
        .order_by((College.code == ref.upper()).desc())
    ).first()
    if college is None:
        raise HTTPException(404, f"No college with the code or link \"{ref}\". Check it and try again.")
    return college


def admin_college(
    ref: str,
    session: DbSession,
    x_admin_key: Annotated[str | None, Header()] = None,
) -> College:
    """FastAPI dependency for every write: the college, if the admin key matches."""
    college = find_college(session, ref)
    if not x_admin_key or not hmac.compare_digest(hash_key(x_admin_key), college.admin_key_hash):
        raise HTTPException(403, BAD_KEY)
    return college


AdminCollegeDep = Annotated[College, Depends(admin_college)]


# ---------- Routes ----------


@router.post("", response_model=CollegeCreated, status_code=201)
def create_college(body: NewCollege, session: DbSession) -> CollegeCreated:
    """Create a college. The admin key in the reply is shown once: it is the admin's password."""
    if body.data is not None:
        check_draft_size(body.data)
    key = secrets.token_urlsafe(32)
    college = College(
        name=body.name.strip(),
        slug=unique_slug(session, body.name),
        code=unique_code(session),
        admin_key_hash=hash_key(key),
    )
    session.add(college)
    session.flush()
    if body.data is not None:
        session.add(CollegeDraft(college_id=college.id, data=body.data))
    session.commit()
    return CollegeCreated(**info(session, college), admin_key=key)


@router.get("/{ref}", response_model=CollegeInfo)
def get_college(ref: str, session: DbSession) -> CollegeInfo:
    """Public: name, share code and whether a timetable is published."""
    return CollegeInfo(**info(session, find_college(session, ref)))


@router.get("/{ref}/timetable", response_model=PublicTimetable)
def get_published(ref: str, session: DbSession) -> PublicTimetable:
    """Public: the live (latest published) timetable, with the data needed to show it."""
    college = find_college(session, ref)
    pub = latest(session, college)
    if pub is None:
        raise HTTPException(404, f"{college.name} hasn't published a timetable yet. Check again later.")
    return PublicTimetable(
        **info(session, college),
        version=pub.version,
        data=CollegeData.model_validate(pub.data),
        result=SolveResult.model_validate(pub.result),
    )


@router.get("/{ref}/admin", response_model=AdminCollege)
def get_admin(college: AdminCollegeDep, session: DbSession) -> AdminCollege:
    """Admin: the saved setup draft, e.g. to continue on another device."""
    draft = session.get(CollegeDraft, college.id)
    return AdminCollege(
        **info(session, college),
        data=draft.data if draft else None,
        data_updated_at=as_utc(draft.updated_at) if draft else None,
    )


@router.put("/{ref}/data", response_model=SavedDraft)
def save_draft(
    college: AdminCollegeDep,
    session: DbSession,
    data: Annotated[dict[str, Any], Body()],
) -> SavedDraft:
    """Admin: autosave the setup draft. Incomplete data is fine; it is checked at Generate."""
    check_draft_size(data)
    if isinstance(data.get("name"), str) and data["name"].strip():
        college.name = data["name"].strip()[:200]
    draft = session.get(CollegeDraft, college.id)
    stamp = now()
    if draft is None:
        session.add(CollegeDraft(college_id=college.id, data=data, updated_at=stamp))
    else:
        draft.data, draft.updated_at = data, stamp
    session.commit()
    return SavedDraft(updated_at=stamp)


@router.post("/{ref}/publish", response_model=Published)
def publish(body: PublishRequest, college: AdminCollegeDep, session: DbSession) -> Published:
    """Admin: make this timetable the live one. It is clash-checked again first."""
    if body.result.status != "solved":
        raise HTTPException(400, "Only a generated timetable can be published. Generate one first.")
    report = check_timetable(body.data, body.result.entries)
    if not report.ok:
        raise HTTPException(
            400,
            f"This timetable has {len(report.clashes) + len(report.violations)} problem(s), "
            "so it wasn't published. Generate it again from the setup.",
        )
    result = body.result.model_copy(update={"check": report})
    current = session.scalar(
        select(func.max(PublishedTimetable.version)).where(PublishedTimetable.college_id == college.id)
    )
    pub = PublishedTimetable(
        college_id=college.id,
        version=(current or 0) + 1,
        data=body.data.model_dump(mode="json"),
        result=result.model_dump(mode="json"),
        published_at=now(),
    )
    session.add(pub)
    session.commit()
    return Published(version=pub.version, published_at=as_utc(pub.published_at))
