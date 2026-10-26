"""POST /colleges/{ref}/ask: the "Ask the timetable" helper.

Builds the helper's Context from the published timetable (with each day's
changes and hall bookings) and calls Claude through backend/assistant/.
ANTHROPIC_API_KEY stays on the server; it is never logged or returned.
Each IP gets a few questions a minute, and every answer has a token cap.
"""

import logging
import os
import threading
import time
from collections import deque
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from assistant import Context, answer
from assistant.chat import ClaudeClient
from assistant.tools import names, when
from solver import CollegeData
from solver.models import Entry

from .bookings import busy_periods
from .changes import Day, actual, load_day
from .colleges import DbSession, find_college, latest

router = APIRouter(tags=["ask"])
log = logging.getLogger("app.ask")

NOT_SET_UP = "The timetable helper isn't set up on this server yet. Everything else works as usual."
KEY_REJECTED = "The timetable helper isn't working right now (its access key was refused). Everything else works as usual."
BUSY = "The timetable helper is busy right now. Try again in a minute."
UNREACHABLE = "The timetable helper can't be reached right now. Try again in a minute."
TOO_FAST = "You're asking very quickly. Wait a minute, then try again."


# ---------- Rate limit ----------


class RateLimiter:
    """Sliding windows per IP (and one for everyone, to cap spending)."""

    def __init__(self, per_minute: int = 8, per_hour: int = 60, all_per_hour: int = 600) -> None:
        self.per_minute, self.per_hour, self.all_per_hour = per_minute, per_hour, all_per_hour
        self.hits: dict[str, deque[float]] = {}
        self.everyone: deque[float] = deque()
        self.lock = threading.Lock()

    def allow(self, ip: str) -> bool:
        now = time.monotonic()
        with self.lock:
            mine = self.hits.setdefault(ip, deque())
            for q in (mine, self.everyone):
                while q and now - q[0] > 3600:
                    q.popleft()
            last_minute = sum(1 for t in mine if now - t < 60)
            if last_minute >= self.per_minute or len(mine) >= self.per_hour or len(self.everyone) >= self.all_per_hour:
                return False
            mine.append(now)
            self.everyone.append(now)
            return True


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Behind Render's proxy the real address is the last one it appended.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


# ---------- Claude client ----------

_client: anthropic.Anthropic | None = None
_client_lock = threading.Lock()


def get_claude() -> ClaudeClient:
    """FastAPI dependency: the Claude client, or a friendly 503 if no API key is configured."""
    global _client
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(503, NOT_SET_UP)
    with _client_lock:
        if _client is None:
            _client = anthropic.Anthropic(timeout=30.0, max_retries=1)
    return _client


# ---------- Request ----------


class Turn(BaseModel):
    question: str = Field(max_length=500)
    answer: str = Field(max_length=2000)


class Me(BaseModel):
    role: Literal["section", "teacher"]
    id: str = Field(max_length=80)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=4, description="Earlier questions and answers, oldest first")
    me: Me | None = Field(None, description="Who is asking, as chosen on My timetable")
    now: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$", description="The asker's local date and time")
    problems: list[str] = Field(default_factory=list, max_length=20, description="From the admin's last generate")
    penalties: dict[str, int] = Field(default_factory=dict, description="Quality score breakdown of the timetable")


class AskOut(BaseModel):
    answer: str
    tools_used: list[str]


def change_notes(day: Day) -> list[tuple[set[str], str]]:
    n = names(day.data)
    out = []
    for c in day.changes:
        span = when(day.data, c.start_period, c.end_period)
        subject = n["subject"].get(c.subject_id, c.subject_id)
        if c.kind == "cancel":
            out.append(({c.section_id, c.teacher_id}, f"Cancelled: {subject} for {c.section_id}, {span}."))
        elif c.kind == "substitute" and c.new_teacher_id:
            out.append(({c.section_id, c.teacher_id, c.new_teacher_id},
                        f"Substitute: {n['teacher'].get(c.new_teacher_id)} takes {subject} for {c.section_id}, {span}, "
                        f"instead of {n['teacher'].get(c.teacher_id)}."))
        elif c.kind == "extra":
            out.append(({c.section_id, c.teacher_id},
                        f"Extra class: {subject} for {c.section_id} with {n['teacher'].get(c.teacher_id)} in "
                        f"{n['room'].get(c.room_id, c.room_id)}, {span}."))
    return out


def build_context(session: Any, college: Any, body: AskIn) -> Context:
    pub = latest(session, college)
    if pub is None:
        raise HTTPException(409, f"{college.name} hasn't published its timetable yet, so there's nothing to ask about.")
    data = CollegeData.model_validate(pub.data)
    if body.now:
        local = datetime.strptime(body.now, "%Y-%m-%dT%H:%M")
    else:
        local = datetime.now(UTC).replace(tzinfo=None)
    days: dict[date, Day] = {}

    def day(d: date) -> Day:
        if d not in days:
            days[d] = load_day(session, college, d)
        return days[d]

    def entries(d: date) -> list[Entry]:
        return actual(day(d))

    raw = {"data": pub.data, "entries": pub.result.get("entries", [])}
    reasons = {"class": "class", "booked": "booked", "requested": "requested by an organiser"}

    def hall_slots(room_id: str, d: date) -> list[tuple[int, str | None]]:
        busy = busy_periods(session, college, raw, room_id, d)
        return [(p, reasons.get(busy[p], busy[p]) if p in busy else None) for p in range(1, data.settings.periods_per_day + 1)]

    return Context(
        data=data, today=local.date(), now_minutes=local.hour * 60 + local.minute,
        day=entries, day_notes=lambda d: change_notes(day(d)), hall_slots=hall_slots,
        me=(body.me.role, body.me.id) if body.me else None,
        problems=body.problems, penalties=body.penalties,
    )


@router.post("/colleges/{ref}/ask", response_model=AskOut)
def ask(ref: str, body: AskIn, request: Request, session: DbSession,
        claude: Annotated[ClaudeClient, Depends(get_claude)]) -> AskOut:
    """Ask the timetable in plain English. Answers come only from the published timetable and its changes."""
    if not limiter.allow(client_ip(request)):
        raise HTTPException(429, TOO_FAST)
    college = find_college(session, ref)
    ctx = build_context(session, college, body)
    try:
        result = answer(claude, ctx, body.question.strip(), [(t.question, t.answer) for t in body.history])
    except anthropic.AuthenticationError:
        log.error("Claude refused the API key (check ANTHROPIC_API_KEY on the server)")
        raise HTTPException(503, KEY_REJECTED) from None
    except anthropic.RateLimitError:
        raise HTTPException(503, BUSY) from None
    except anthropic.APIStatusError as e:
        log.error("Claude API error %s", e.status_code)
        raise HTTPException(503, BUSY if e.status_code >= 500 else UNREACHABLE) from None
    except anthropic.APIConnectionError:
        raise HTTPException(503, UNREACHABLE) from None
    except anthropic.AnthropicError as e:
        log.error("Claude client error: %s", type(e).__name__)
        raise HTTPException(503, UNREACHABLE) from None
    return AskOut(answer=result.text, tools_used=result.tools_used)
