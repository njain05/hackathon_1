"""The helper's tools: small functions over the real timetable.

Every answer the helper gives comes from one of these. They take a Context
built by the app (published timetable, the day's changes, hall bookings) and
return short plain text for Claude to read. No FastAPI, no database here.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from solver.models import CollegeData, Entry

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


@dataclass
class Context:
    data: CollegeData
    today: date
    now_minutes: int  # the asker's local clock, minutes since midnight
    # The actual timetable for a date (published weekday + that date's changes).
    day: Callable[[date], list[Entry]]
    # That date's changes in plain English, each with the section and teacher codes it is about.
    day_notes: Callable[[date], list[tuple[set[str], str]]]
    # An event hall's periods on a date: (period, None if free else why it's taken).
    hall_slots: Callable[[str, date], list[tuple[int, str | None]]]
    # The asker, if they told /my who they are: ("section" | "teacher", id).
    me: tuple[str, str] | None = None
    # From the admin's last generate: problems and the quality score breakdown.
    problems: list[str] = field(default_factory=list)
    penalties: dict[str, int] = field(default_factory=dict)


# ---------- Words for times, days and names ----------


def period_times(data: CollegeData) -> dict[int, tuple[int, int]]:
    """Period → (start, end) in minutes since midnight, from the college's own settings."""
    s = data.settings
    h, m = (int(x) for x in s.day_start.split(":"))
    t, out = h * 60 + m, {}
    breaks = {b.after_period: b.minutes for b in s.breaks}
    for p in range(1, s.periods_per_day + 1):
        length = s.period_lengths[p - 1] if s.period_lengths else s.period_minutes
        out[p] = (t, t + length)
        t += length + breaks.get(p, 0)
    return out


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def when(data: CollegeData, start: int, end: int) -> str:
    times = period_times(data)
    label = f"P{start}" if start == end else f"P{start}–{end}"
    return f"{label} {hhmm(times[start][0])}–{hhmm(times[end][1])}" if start in times and end in times else label


def college_day(data: CollegeData, d: date) -> tuple[str, bool]:
    """The college's own name for this date's weekday, and whether classes run that day."""
    weekday = d.strftime("%A")
    match = next((x for x in data.settings.days if x.strip().lower()[:3] == weekday.lower()[:3]), None)
    return (match, True) if match else (weekday, False)


def resolve_date(ctx: Context, text: str) -> date | str:
    """"today", "tomorrow", "Monday", "next Fri", "2026-11-02" → a date; otherwise an error message."""
    t = text.strip().lower().rstrip(".")
    if t in ("", "today", "now"):
        return ctx.today
    if t == "tomorrow":
        return ctx.today + timedelta(days=1)
    try:
        return date.fromisoformat(t)
    except ValueError:
        pass
    nxt = t.startswith("next ")
    word = t.removeprefix("next ").strip()[:3]
    for i, name in enumerate(WEEKDAYS):
        if name[:3] == word:
            ahead = (i - ctx.today.weekday()) % 7
            return ctx.today + timedelta(days=ahead or (7 if nxt else 0))
    return f'"{text}" isn\'t a day I understand. Use today, tomorrow, a weekday name or a date like 2026-11-02.'


def day_label(ctx: Context, d: date) -> str:
    rel = {0: "today", 1: "tomorrow"}.get((d - ctx.today).days)
    return f"{d.strftime('%A %d %b %Y')}" + (f" ({rel})" if rel else "")


def names(data: CollegeData) -> dict[str, dict[str, str]]:
    return {
        "subject": {s.id: s.name or s.id for s in data.subjects},
        "teacher": {t.id: t.name or t.id for t in data.teachers},
        "section": {s.id: s.name or s.id for s in data.sections},
        "room": {r.id: r.name or r.id for r in data.rooms},
    }


def find_who(ctx: Context, who: str) -> tuple[str, str, str] | str:
    """A section or teacher by code or (part of a) name → (kind, id, label); otherwise an error message."""
    q = who.strip().lower()
    if q in ("me", "my", "i", "mine", "myself"):
        if not ctx.me or not ctx.me[1]:
            return "I don't know who is asking. Ask for their section (students) or name (teachers)."
        q = ctx.me[1].lower()
    people = [("section", s.id, s.name) for s in ctx.data.sections] + [("teacher", t.id, t.name) for t in ctx.data.teachers]
    exact = [p for p in people if q in (p[1].lower(), (p[2] or "").lower())]
    found = exact or [p for p in people if q and q in f"{p[1]} {p[2] or ''}".lower()]
    if len(found) == 1:
        kind, id_, name = found[0]
        return kind, id_, f"{name} ({id_})" if name and name != id_ else id_
    if not found:
        return f'No section or teacher matches "{who}".'
    options = "; ".join(f"{p[2] or p[1]} ({p[1]})" for p in found[:8])
    return f'"{who}" matches several: {options}. Ask which one they mean.'


def involves(e: Entry, kind: str, id_: str) -> bool:
    if kind == "teacher":
        return e.teacher_id == id_
    return e.section_id == id_ or id_ in (e.elective_sections or [])


def describe(data: CollegeData, e: Entry, kind: str) -> str:
    n = names(data)
    what = n["subject"].get(e.subject_id, e.subject_id) + (" (lab)" if e.kind == "lab" else " (elective option)" if e.kind == "elective" else "")
    other = n["section"].get(e.section_id, e.section_id) if kind == "teacher" else n["teacher"].get(e.teacher_id, e.teacher_id)
    return f"{what} — {other} — {n['room'].get(e.room_id, e.room_id)}"


def blocks(entries: list[Entry]) -> list[tuple[int, int, list[Entry]]]:
    """Group a day's entries by period, merging a lab or elective that spans periods into one line."""
    by_p: dict[int, list[Entry]] = {}
    for e in sorted(entries, key=lambda x: (x.period, x.subject_id, x.room_id)):
        by_p.setdefault(e.period, []).append(e)
    out: list[tuple[int, int, list[Entry]]] = []
    key = lambda es: sorted((x.subject_id, x.teacher_id, x.room_id, x.section_id) for x in es)  # noqa: E731
    for p in sorted(by_p):
        if out and out[-1][1] == p - 1 and key(out[-1][2]) == key(by_p[p]) and by_p[p][0].kind != "lecture":
            out[-1] = (out[-1][0], p, out[-1][2])
        else:
            out.append((p, p, by_p[p]))
    return out


# ---------- The tools ----------


def get_schedule(ctx: Context, who: str, day: str) -> str:
    target = find_who(ctx, who)
    if isinstance(target, str):
        return target
    kind, id_, label = target
    d = resolve_date(ctx, day)
    if isinstance(d, str):
        return d
    _, working = college_day(ctx.data, d)
    mine = [e for e in ctx.day(d) if involves(e, kind, id_)]
    notes = [text for ids, text in ctx.day_notes(d) if id_ in ids]
    head = f"{label} on {day_label(ctx, d)}"
    if not mine:
        why = "" if working else " (no classes run on this day)"
        return "\n".join([f"{head}: no classes{why}.", *notes])
    lines = [f"{head} (today's changes included):"]
    for a, b, es in blocks(mine):
        lines.append(f"{when(ctx.data, a, b)}: " + " | ".join(describe(ctx.data, e, kind) for e in es))
    return "\n".join([*lines, *(["Changes:", *notes] if notes else [])])


def parse_now(ctx: Context, now: str) -> int | str:
    t = now.strip().lower()
    if t in ("", "now"):
        return ctx.now_minutes
    for fmt in ("%H:%M", "%I:%M %p", "%I %p", "%I:%M%p", "%I%p"):
        try:
            x = datetime.strptime(t.upper(), fmt)
            return x.hour * 60 + x.minute
        except ValueError:
            continue
    return f'"{now}" isn\'t a time I understand. Use "now" or a time like 14:30.'


def whats_next(ctx: Context, who: str, now: str) -> str:
    target = find_who(ctx, who)
    if isinstance(target, str):
        return target
    kind, id_, label = target
    minutes = parse_now(ctx, now)
    if isinstance(minutes, str):
        return minutes
    times = period_times(ctx.data)
    today = [b for b in blocks([e for e in ctx.day(ctx.today) if involves(e, kind, id_)])]
    lines = [f"For {label}, it is {hhmm(minutes)} on {day_label(ctx, ctx.today)}."]
    current = next((b for b in today if times[b[0]][0] <= minutes < times[b[1]][1]), None)
    if current:
        lines.append(f"Now: {when(ctx.data, current[0], current[1])}: {describe(ctx.data, current[2][0], kind)}.")
    upcoming = [b for b in today if times[b[0]][0] >= minutes and b is not current]
    if upcoming:
        a, b, es = upcoming[0]
        lines.append(f"Next: {when(ctx.data, a, b)}: {describe(ctx.data, es[0], kind)} (starts in {times[a][0] - minutes} min).")
        return "\n".join(lines)
    lines.append("No more classes today.")
    for i in range(1, 8):  # the next day with a class
        d = ctx.today + timedelta(days=i)
        later = blocks([e for e in ctx.day(d) if involves(e, kind, id_)])
        if later:
            a, b, es = later[0]
            lines.append(f"Next class: {day_label(ctx, d)}, {when(ctx.data, a, b)}: {describe(ctx.data, es[0], kind)}.")
            break
    return "\n".join(lines)


def free_rooms(ctx: Context, day: str, period: int) -> str:
    d = resolve_date(ctx, day)
    if isinstance(d, str):
        return d
    if period not in period_times(ctx.data):
        return f"There is no period {period}. Periods run 1 to {ctx.data.settings.periods_per_day}."
    uses = {t.id: t.use for t in ctx.data.room_types}
    used = {e.room_id for e in ctx.day(d) if e.period == period}
    free = [r for r in ctx.data.rooms if uses.get(r.type) != "event" and r.id not in used]
    head = f"Free rooms on {day_label(ctx, d)}, {when(ctx.data, period, period)}"
    if not free:
        return f"{head}: none, every classroom and lab is in use."
    kinds = {t.id: t.name for t in ctx.data.room_types}
    return f"{head}:\n" + "\n".join(
        f"{r.name or r.id} ({r.id}) — {kinds.get(r.type, r.type)}, seats {r.capacity}" + (f", {r.department_id} only" if r.department_id else "")
        for r in sorted(free, key=lambda r: (uses.get(r.type) != "lecture", r.capacity))
    )


def teacher_free_slots(ctx: Context, teacher: str, day: str) -> str:
    target = find_who(ctx, teacher)
    if isinstance(target, str):
        return target
    kind, id_, label = target
    if kind != "teacher":
        return f'"{teacher}" is a section, not a teacher.'
    d = resolve_date(ctx, day)
    if isinstance(d, str):
        return d
    day_name, working = college_day(ctx.data, d)
    t = next(x for x in ctx.data.teachers if x.id == id_)
    off = {s.period for s in t.unavailable if s.day == day_name}
    busy = {e.period: e for e in ctx.day(d) if e.teacher_id == id_}
    free, taken = [], []
    for p in period_times(ctx.data):
        if p in busy:
            taken.append(f"{when(ctx.data, p, p)} teaching {names(ctx.data)['section'].get(busy[p].section_id, busy[p].section_id)}")
        elif p in off:
            taken.append(f"{when(ctx.data, p, p)} marked unavailable")
        else:
            free.append(when(ctx.data, p, p))
    head = f"{label} on {day_label(ctx, d)}" + ("" if working else " (no classes run on this day)")
    return "\n".join([f"{head}.", "Free: " + (", ".join(free) or "none"), *(["Busy: " + "; ".join(taken)] if taken else [])])


def hall_free_slots(ctx: Context, room: str, day: str) -> str:
    uses = {t.id: t.use for t in ctx.data.room_types}
    halls = [r for r in ctx.data.rooms if uses.get(r.type) == "event"]
    if not halls:
        return "This college has no seminar halls or auditoriums set up for bookings."
    q = room.strip().lower()
    match = [r for r in halls if q in (r.id.lower(), (r.name or "").lower())] or [r for r in halls if q and q in f"{r.id} {r.name}".lower()]
    if len(match) != 1:
        listing = "; ".join(f"{r.name or r.id} ({r.id}, seats {r.capacity})" for r in halls)
        return (f'"{room}" matches several halls' if match else f'No hall matches "{room}"') + f". Halls: {listing}."
    hall = match[0]
    d = resolve_date(ctx, day)
    if isinstance(d, str):
        return d
    if d < ctx.today:
        return f"{day_label(ctx, d)} has passed."
    slots = ctx.hall_slots(hall.id, d)
    free = [when(ctx.data, p, p) for p, why in slots if why is None]
    taken = [f"{when(ctx.data, p, p)} ({why})" for p, why in slots if why is not None]
    return "\n".join([
        f"{hall.name or hall.id} (seats {hall.capacity}) on {day_label(ctx, d)}.",
        "Free: " + (", ".join(free) or "none"),
        *(["Taken: " + ", ".join(taken)] if taken else []),
        "To book it, use the Book a hall page.",
    ])


PENALTY_WORDS = {
    "subject_repeats_same_day": "times a subject comes twice on one day",
    "teacher_long_runs": "teaching runs longer than 3 periods",
    "student_gaps": "free periods between a section's classes",
    "teacher_load_imbalance": "uneven teacher load across days",
}


def explain_problems(ctx: Context) -> str:
    if ctx.problems:
        return "Problems from the last timetable generation:\n" + "\n".join(f"- {p}" for p in ctx.problems)
    if ctx.penalties:
        parts = [f"{PENALTY_WORDS.get(k, k.replace('_', ' '))}: {v}" for k, v in ctx.penalties.items() if v]
        return "No problems: the timetable was generated with 0 clashes. Quality score breakdown (lower is better): " + (
            "; ".join(parts) or "all zero, the best possible."
        )
    return "No problems recorded for the last timetable generation."


# ---------- Definitions for Claude ----------


def _schema(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


WHO = {"type": "string", "description": 'A section code or name (e.g. "CSE-3A") or a teacher\'s code or name (e.g. "HK", "Harpreet"). Use "me" for the person asking.'}
DAY = {"type": "string", "description": 'today, tomorrow, a weekday name (e.g. "Monday", "next Fri") or a date YYYY-MM-DD'}

TOOLS: list[dict[str, Any]] = [
    {"name": "get_schedule", "description": "A section's or teacher's classes on one day, with times, subjects, rooms and that day's changes (substitutes, cancellations, extra classes).",
     "input_schema": _schema({"who": WHO, "day": DAY})},
    {"name": "whats_next", "description": "The class happening now and the next class for a section or teacher.",
     "input_schema": _schema({"who": WHO, "now": {"type": "string", "description": 'Usually "now"; or a time like 14:30'}})},
    {"name": "free_rooms", "description": "Classrooms and labs with no class in one period on one day.",
     "input_schema": _schema({"day": DAY, "period": {"type": "integer", "description": "Period number, 1 = first period"}})},
    {"name": "teacher_free_slots", "description": "The periods a teacher is free (no class, not marked unavailable) on one day.",
     "input_schema": _schema({"teacher": WHO, "day": DAY})},
    {"name": "hall_free_slots", "description": "Free periods of a seminar hall or auditorium on a date (not used by classes or by approved or pending bookings).",
     "input_schema": _schema({"room": {"type": "string", "description": "Hall code or name"}, "day": DAY})},
    {"name": "explain_problems", "description": "Why the last timetable generation failed, or what its quality score is made of.",
     "input_schema": _schema({})},
]
for _t in TOOLS:
    _t["strict"] = True

RUN: dict[str, Callable[..., str]] = {
    "get_schedule": get_schedule,
    "whats_next": whats_next,
    "free_rooms": free_rooms,
    "teacher_free_slots": teacher_free_slots,
    "hall_free_slots": hall_free_slots,
    "explain_problems": explain_problems,
}


def run_tool(ctx: Context, name: str, args: dict[str, Any]) -> str:
    """Run one tool by name. Unknown tools and bad arguments raise ValueError (sent back as is_error)."""
    fn = RUN.get(name)
    if fn is None:
        raise ValueError(f"There is no tool called {name}.")
    try:
        return fn(ctx, **args)
    except TypeError as e:
        raise ValueError(f"Wrong arguments for {name}: {e}") from None
