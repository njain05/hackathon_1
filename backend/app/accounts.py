"""Sign in with a username and password: the Dean, HODs, in-charges, teachers and students.

An account belongs to one college; its username is unique within that college.
The password is stored only as a scrypt hash. A staff account also holds the
access key that person's pages already use (the Dean's admin key, or an HOD's,
in-charge's or teacher's member key), sealed with a key derived from their
password. So signing in hands the browser exactly the key every existing
endpoint checks, and the server can't read a stored key without the password.
Students hold no key, only their section: the published timetable is public.

The Dean (X-Admin-Key) makes everyone's accounts; an HOD makes their
department's timetable in-charge. A new HOD, in-charge or teacher account
replaces that person's old link.
"""

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .colleges import AdminCollegeDep, DbSession, find_college, hash_key, latest
from .db import Base, College, CollegeDraft, Member, as_utc, now
from .demo import DEMO_USERNAMES, DemoCollege, is_demo, refuse_if_demo
from .departments import StaffDep, current_incharge

router = APIRouter(tags=["accounts"])

Role = Literal["dean", "hod", "incharge", "teacher", "student"]
STAFF_ROLES = ("hod", "incharge", "teacher")
ROLE_NAME = {"dean": "Dean", "hod": "HOD", "incharge": "Timetable in-charge", "teacher": "Teacher", "student": "Student"}
MAX_TRIES = 5
LOCK = timedelta(minutes=5)
WRONG = "Wrong username or password. Check the college code too."


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("college_id", "username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), index=True)
    username: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(20))  # Role
    department_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    teacher_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    section_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    member_id: Mapped[int | None] = mapped_column(ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    password_salt: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(128))
    key_salt: Mapped[str] = mapped_column(String(64), default="")
    key_box: Mapped[str] = mapped_column(String(256), default="")  # the sealed access key (hex), "" for students
    failed: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Passwords and sealed keys ----------


def _kdf(password: str, salt: bytes, size: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=size)


def set_password(a: Account, password: str, key: str | None) -> None:
    """Store the password's hash and seal `key` (the access key) with it."""
    salt = secrets.token_bytes(16)
    a.password_salt, a.password_hash = salt.hex(), _kdf(password, salt, 32).hex()
    if key is None:
        a.key_salt, a.key_box = "", ""
        return
    raw = key.encode()
    ksalt = secrets.token_bytes(16)
    pad = _kdf(password, ksalt, len(raw))
    a.key_salt, a.key_box = ksalt.hex(), bytes(x ^ y for x, y in zip(raw, pad)).hex()


def check_password(a: Account, password: str) -> bool:
    return hmac.compare_digest(_kdf(password, bytes.fromhex(a.password_salt), 32).hex(), a.password_hash)


def open_key(a: Account, password: str) -> str | None:
    if not a.key_box:
        return None
    box = bytes.fromhex(a.key_box)
    pad = _kdf(password, bytes.fromhex(a.key_salt), len(box))
    return bytes(x ^ y for x, y in zip(box, pad)).decode()


ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o, 1/l/i


def new_password() -> str:
    """Easy to read out or type: e.g. "k7mq-2xpf"."""
    def part() -> str:
        return "".join(secrets.choice(ALPHABET) for _ in range(4))

    return f"{part()}-{part()}"


USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{1,59}$")


def clean_username(raw: str) -> str:
    u = raw.strip().lower().replace(" ", "")
    if not USERNAME.match(u):
        raise HTTPException(422, f'"{raw.strip()}" can\'t be a username: use 2 to 60 letters, numbers, dots, dashes or underscores.')
    return u


def check_new_password(p: str) -> None:
    if len(p) < 6:
        raise HTTPException(422, "Choose a password of at least 6 characters.")


# ---------- Lookups ----------


def find_account(session: Session, college: College, username: str) -> Account | None:
    return session.scalar(select(Account).where(Account.college_id == college.id, Account.username == username.strip().lower()))


def college_data(session: Session, college: College) -> dict[str, Any]:
    """The setup as saved online (or the published one), to check codes against."""
    draft = session.get(CollegeDraft, college.id)
    if draft is not None and isinstance(draft.data, dict):
        return draft.data
    pub = latest(session, college)
    return pub.data if pub is not None else {}


def ids(data: dict[str, Any], collection: str) -> dict[str, dict[str, Any]]:
    return {str(r.get("id")): r for r in data.get(collection) or [] if isinstance(r, dict)}


# ---------- Signing in ----------


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class LoginOut(BaseModel):
    username: str
    name: str
    role: Role
    college_code: str
    college_slug: str
    college_name: str
    key: str | None = Field(None, description="The admin key (Dean) or member key (HOD, in-charge, teacher). None for students.")
    department_id: str | None = None
    teacher_id: str | None = None
    section_id: str | None = None


def login_out(a: Account, college: College, key: str | None) -> LoginOut:
    return LoginOut(
        username=a.username, name=a.name, role=cast(Role, a.role), college_code=college.code, college_slug=college.slug,
        college_name=college.name, key=key, department_id=a.department_id, teacher_id=a.teacher_id, section_id=a.section_id,
    )


@router.post("/colleges/{ref}/login", response_model=LoginOut)
def login(ref: str, body: LoginIn, session: DbSession) -> LoginOut:
    """Sign in. Returns the access the browser needs for this person's pages."""
    try:
        college = find_college(session, ref)
    except HTTPException:
        raise HTTPException(401, WRONG) from None
    a = find_account(session, college, body.username)
    if a is None:
        raise HTTPException(401, WRONG)
    if a.locked_until is not None and as_utc(a.locked_until) > now():
        raise HTTPException(429, "Too many wrong tries. Wait 5 minutes, then try again.")
    if not check_password(a, body.password):
        a.failed += 1
        if a.failed >= MAX_TRIES:
            a.failed, a.locked_until = 0, now() + LOCK
        session.commit()
        raise HTTPException(401, WRONG)
    a.failed, a.locked_until = 0, None
    key = open_key(a, body.password)
    if a.role in STAFF_ROLES:
        m = session.get(Member, a.member_id) if a.member_id else None
        if m is None or m.revoked_at is not None:
            session.commit()
            raise HTTPException(403, "This sign-in was replaced by a newer one. Ask the Dean for your new password.")
    session.commit()
    return login_out(a, college, key)


class PasswordIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    old_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


@router.post("/colleges/{ref}/password", status_code=204)
def change_password(ref: str, body: PasswordIn, session: DbSession) -> None:
    """Anyone: change your own password (needs the current one)."""
    college = find_college(session, ref)
    a = find_account(session, college, body.username)
    if a is None or not check_password(a, body.old_password):
        raise HTTPException(401, "Your current password isn't right.")
    if a.username in DEMO_USERNAMES:
        refuse_if_demo(session, college, "the demo sign-ins' passwords")
    check_new_password(body.new_password)
    set_password(a, body.new_password, open_key(a, body.old_password))
    session.commit()


# ---------- The Dean's own sign-in ----------


class DeanIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)
    name: str = Field("Dean", max_length=120)


class AccountOut(BaseModel):
    username: str
    name: str
    role: Role
    department_id: str | None = None
    teacher_id: str | None = None
    section_id: str | None = None
    created_at: datetime


class Made(BaseModel):
    username: str
    name: str
    role: Role
    password: str = Field(description="Shown once: give it to the person.")


def account_out(a: Account) -> AccountOut:
    return AccountOut(username=a.username, name=a.name, role=cast(Role, a.role), department_id=a.department_id,
                      teacher_id=a.teacher_id, section_id=a.section_id, created_at=as_utc(a.created_at))


@router.post("/colleges/{ref}/accounts/dean", response_model=AccountOut)
def set_dean(body: DeanIn, college: AdminCollegeDep, session: DbSession, x_admin_key: Annotated[str, Header()]) -> AccountOut:
    """The Dean (with the admin link) chooses their username and password. Doing it again replaces them."""
    refuse_if_demo(session, college, "the Dean's sign-in")
    username = clean_username(body.username)
    check_new_password(body.password)
    other = find_account(session, college, username)
    if other is not None and other.role != "dean":
        raise HTTPException(409, f'The username "{username}" is already taken in this college. Choose another.')
    for old in session.scalars(select(Account).where(Account.college_id == college.id, Account.role == "dean")):
        if old.username != username:
            session.delete(old)
    a = other or Account(college_id=college.id, username=username, role="dean")
    a.name = body.name.strip() or "Dean"
    set_password(a, body.password, x_admin_key)
    session.add(a)
    session.commit()
    return account_out(a)


# ---------- Accounts the Dean makes ----------


class NewAccount(BaseModel):
    role: Literal["hod", "incharge", "teacher", "student"]
    username: str = Field(min_length=1, max_length=80)
    name: str = Field("", max_length=120)
    department_id: str | None = Field(None, max_length=80)
    teacher_id: str | None = Field(None, max_length=80)
    section_id: str | None = Field(None, max_length=80)
    password: str | None = Field(None, max_length=200, description="Leave out to get an easy-to-type one.")


def make_account(session: Session, college: College, body: NewAccount, data: dict[str, Any]) -> Made:
    """Check the codes, replace this role's old sign-in, and make the account (and its member key)."""
    username = clean_username(body.username)
    if find_account(session, college, username) is not None:
        raise HTTPException(409, f'The username "{username}" is already taken in this college. Choose another.')
    password = body.password or new_password()
    check_new_password(password)
    depts, teachers, sections = ids(data, "departments"), ids(data, "teachers"), ids(data, "sections")
    dept, name = body.department_id, body.name.strip()

    if body.role == "student":
        if body.section_id not in sections:
            raise HTTPException(422, f'There is no section "{body.section_id or ""}" in the setup.')
        dept = sections[body.section_id].get("department_id")
    elif body.role == "teacher":
        if body.teacher_id not in teachers:
            raise HTTPException(422, f'There is no teacher "{body.teacher_id or ""}" in the setup.')
        t = teachers[body.teacher_id]
        dept, name = t.get("department_id") or dept, name or t.get("name") or body.teacher_id
    elif dept not in depts:
        raise HTTPException(422, f'There is no department "{dept or ""}" in the setup.')

    key: str | None = None
    member_id: int | None = None
    if body.role in STAFF_ROLES:
        # One HOD and one in-charge per department, one sign-in per teacher: the new one replaces the old.
        q = select(Member).where(Member.college_id == college.id, Member.role == body.role, Member.revoked_at.is_(None))
        q = q.where(Member.teacher_id == body.teacher_id) if body.role == "teacher" else q.where(Member.department_id == dept)
        for old in session.scalars(q):
            old.revoked_at = now()
            for acc in session.scalars(select(Account).where(Account.member_id == old.id)):
                session.delete(acc)
        key = secrets.token_urlsafe(24)
        m = Member(college_id=college.id, department_id=dept or "", role=body.role, name=name or username,
                   teacher_id=body.teacher_id if body.role == "teacher" else None, key_hash=hash_key(key))
        session.add(m)
        session.flush()
        member_id = m.id

    a = Account(college_id=college.id, username=username, name=name or username, role=body.role, department_id=dept,
                teacher_id=body.teacher_id if body.role == "teacher" else None,
                section_id=body.section_id if body.role == "student" else None, member_id=member_id)
    set_password(a, password, key)
    session.add(a)
    session.flush()
    return Made(username=username, name=a.name, role=body.role, password=password)


@router.post("/colleges/{ref}/accounts", response_model=Made, status_code=201)
def create_account(body: NewAccount, college: AdminCollegeDep, session: DbSession) -> Made:
    """Dean: a sign-in for an HOD, in-charge, teacher or student. The password is shown once."""
    if body.role != "student":
        refuse_if_demo(session, college, "its staff sign-ins (new students are fine)")
    made = make_account(session, college, body, college_data(session, college))
    session.commit()
    return made


class BulkRow(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    name: str = Field("", max_length=120)
    section_id: str | None = Field(None, max_length=80)
    teacher_id: str | None = Field(None, max_length=80)


class BulkIn(BaseModel):
    role: Literal["teacher", "student"]
    rows: list[BulkRow] = Field(max_length=2000)


class BulkOut(BaseModel):
    made: list[Made]
    problems: list[str] = Field(description='e.g. "Row 3 (21cse045): there is no section CSE-9A in the setup."')


@router.post("/colleges/{ref}/accounts/bulk", response_model=BulkOut)
def create_accounts(body: BulkIn, college: AdminCollegeDep, session: DbSession) -> BulkOut:
    """Dean: many teacher or student sign-ins at once (e.g. pasted from Excel). Bad rows are skipped and named."""
    if body.role != "student":
        refuse_if_demo(session, college, "its staff sign-ins (new students are fine)")
    data = college_data(session, college)
    made: list[Made] = []
    problems: list[str] = []
    for i, r in enumerate(body.rows, start=1):
        try:
            with session.begin_nested():
                made.append(make_account(session, college, NewAccount(role=body.role, **r.model_dump()), data))
        except HTTPException as e:
            problems.append(f"Row {i} ({r.username.strip()}): {e.detail}")
    session.commit()
    return BulkOut(made=made, problems=problems)


@router.get("/colleges/{ref}/accounts", response_model=list[AccountOut])
def list_accounts(college: AdminCollegeDep, session: DbSession) -> list[AccountOut]:
    """Dean: everyone who can sign in (never their passwords)."""
    rows = session.scalars(select(Account).where(Account.college_id == college.id).order_by(Account.role, Account.username))
    return [account_out(a) for a in rows]


@router.post("/colleges/{ref}/accounts/{username}/reset", response_model=Made)
def reset_password(username: str, college: AdminCollegeDep, session: DbSession) -> Made:
    """Dean: a new password for someone who forgot theirs. Their old sign-in and link stop working."""
    a = find_account(session, college, username)
    if a is None:
        raise HTTPException(404, f'No one signs in as "{username}" here.')
    if a.username in DEMO_USERNAMES:
        refuse_if_demo(session, college, "the demo sign-ins")
    if a.role == "dean":
        raise HTTPException(409, "Change the Dean's password on the Dean's own page instead.")
    key: str | None = None
    if a.role in STAFF_ROLES:
        m = session.get(Member, a.member_id) if a.member_id else None
        if m is None or m.revoked_at is not None:
            raise HTTPException(409, f"{a.name}'s sign-in was replaced by a newer one. Make a new account instead.")
        key = secrets.token_urlsafe(24)
        m.key_hash = hash_key(key)
    password = new_password()
    set_password(a, password, key)
    a.failed, a.locked_until = 0, None
    session.commit()
    return Made(username=a.username, name=a.name, role=cast(Role, a.role), password=password)


@router.delete("/colleges/{ref}/accounts/{username}", status_code=204)
def delete_account(username: str, college: AdminCollegeDep, session: DbSession) -> None:
    """Dean: remove someone's sign-in (and the link that went with it)."""
    a = find_account(session, college, username)
    if a is None:
        raise HTTPException(404, f'No one signs in as "{username}" here.')
    if a.username in DEMO_USERNAMES:
        refuse_if_demo(session, college, "the demo sign-ins")
    if a.member_id:
        m = session.get(Member, a.member_id)
        if m is not None and m.revoked_at is None:
            m.revoked_at = now()
    session.delete(a)
    session.commit()


# ---------- The HOD makes the in-charge's sign-in ----------


class InchargeAccountIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    password: str | None = Field(None, max_length=200)


@router.post("/colleges/{ref}/departments/{department_id}/incharge-account", response_model=Made, status_code=201)
def make_incharge_account(department_id: str, body: InchargeAccountIn, who: StaffDep, session: DbSession) -> Made:
    """The HOD (or the Dean): a sign-in for the department's timetable in-charge. It replaces the old one."""
    if not who.heads(department_id):
        raise HTTPException(403, "Only this department's HOD or the Dean can choose its timetable in-charge.")
    refuse_if_demo(session, who.college, "its timetable in-charge")
    old = current_incharge(session, who.college, department_id)
    if old is not None:
        old.revoked_at = now()
    made = make_account(
        session, who.college,
        NewAccount(role="incharge", username=body.username, name=body.name, department_id=department_id, password=body.password),
        college_data(session, who.college),
    )
    session.commit()
    return made


# ---------- The public demo college ----------


@router.post("/colleges/{ref}/demo", status_code=204)
def make_demo(college: AdminCollegeDep, session: DbSession) -> None:
    """Mark this college as the shared demo: from now on its setup, published timetable and
    demo sign-ins can't be changed (see app/demo.py). One way only; backend/seed_demo.py calls it."""
    if not is_demo(session, college):
        session.add(DemoCollege(college_id=college.id))
        session.commit()
