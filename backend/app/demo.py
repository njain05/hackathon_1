"""The public demo college. Its sign-ins are shown on the Sign in page so evaluators can
try every role, so the server keeps it intact: its setup, its published timetable and
the demo sign-ins can't be changed. Leave, cover, bookings, approvals and new student
sign-ins still work, so there is plenty to try. A college is made a demo (one way only)
by POST /colleges/{ref}/demo with its admin key; backend/seed_demo.py does that.
"""

from fastapi import HTTPException
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, College

DEMO_USERNAMES = frozenset({"dean", "hod", "incharge", "teacher", "student"})


class DemoCollege(Base):
    __tablename__ = "demo_colleges"

    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), primary_key=True)


def is_demo(session: Session, college: College) -> bool:
    return session.get(DemoCollege, college.id) is not None


def refuse_if_demo(session: Session, college: College, what: str) -> None:
    """403 with a friendly reason if `college` is the shared demo college."""
    if is_demo(session, college):
        raise HTTPException(
            403,
            f"This is the shared demo college, so {what} can't be changed here. "
            "To try that, sign out and start your own college (home page → New college? Set it up).",
        )
