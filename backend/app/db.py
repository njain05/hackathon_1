"""Database for saved colleges, setup drafts and published timetables.

DATABASE_URL picks the database: a SQLite file locally (the default), Supabase
Postgres in production (Render's disk is wiped on every restart). This lives in
app/, not solver/: the solver stays pure.
"""

import logging
import os
import re
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

DEFAULT_URL = f"sqlite:///{Path(__file__).resolve().parent.parent / 'timetable.db'}"

log = logging.getLogger("app.db")


class DatabaseUnavailable(Exception):
    """The database can't be reached or DATABASE_URL is wrong. Shown to users as a 503."""


def redact(message: str) -> str:
    """Hide the password of any database URL in a message, before it is logged or shown."""
    # Greedy to the last "@" in the URL, so a password that itself contains "@" is hidden too.
    return re.sub(r"(://[^:/@\s]+:)\S*@", r"\1***@", message)


def now() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    """SQLite drops the time zone; every time we store is UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class College(Base):
    __tablename__ = "colleges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)  # for share links
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)  # short code to type
    admin_key_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CollegeDraft(Base):
    """The admin's setup data. May be incomplete (it autosaves while they type)."""

    __tablename__ = "college_data"

    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PublishedTimetable(Base):
    """One published version: the SolveResult plus the college data it was made from."""

    __tablename__ = "timetables"
    __table_args__ = (UniqueConstraint("college_id", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    result: Mapped[dict[str, Any]] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def normalise_url(url: str) -> str:
    """Supabase and Render hand out postgres:// URLs; SQLAlchemy needs the driver named."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


_lock = threading.Lock()
_engine: Engine | None = None
_sessions: sessionmaker[Session] | None = None


def configure(url: str | None = None) -> None:
    """Connect to DATABASE_URL (or `url`) and create any missing tables."""
    global _engine, _sessions
    url = normalise_url(url or os.getenv("DATABASE_URL") or DEFAULT_URL)
    connect_args: dict[str, Any] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False  # FastAPI uses worker threads
    elif url.startswith("postgresql+psycopg"):
        connect_args["prepare_threshold"] = None  # Supabase's pooler can't keep prepared statements
        connect_args["connect_timeout"] = 10  # fail with a clear error instead of hanging
    engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)
    Base.metadata.create_all(engine)
    if _engine is not None:
        _engine.dispose()
    _engine, _sessions = engine, sessionmaker(engine, expire_on_commit=False)


def reset() -> None:
    """Forget the connection, so the next request connects again (used by tests)."""
    global _engine, _sessions
    if _engine is not None:
        _engine.dispose()
    _engine, _sessions = None, None


def _connect() -> sessionmaker[Session]:
    if _sessions is None:
        with _lock:
            if _sessions is None:
                try:
                    configure()
                except Exception as e:  # a bad URL fails in many ways; all mean the same to users
                    raise DatabaseUnavailable(redact(f"{type(e).__name__}: {e}")) from None
    assert _sessions is not None
    return _sessions


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request. Connects on first use and retries until it works."""
    with _connect()() as session:
        yield session


def status() -> dict[str, str]:
    """For GET /health/db: can the server reach its database? Never includes the password."""
    try:
        _connect()
        assert _engine is not None
        with _engine.connect() as conn:
            conn.execute(text("select 1"))
        return {"database": "ok", "kind": _engine.url.get_backend_name()}
    except Exception as e:
        reason = str(e) if isinstance(e, DatabaseUnavailable) else f"{type(e).__name__}: {e}"
        return {"database": "error", "error": redact(reason).strip().splitlines()[0][:500]}
