"""CP-SAT timetable model.

Variables
- lecture[a, day, period, room]: assignment a has a lecture there.
- lab[a, day, start, room]: assignment a starts a lab block there. One variable
  covers the whole block, so lab periods are consecutive by construction, and
  only starts that don't cross a break or the end of the day exist.

Hard rules are constraints. Soft rules are penalties in the objective.
"""

import os
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from ortools.sat.python import cp_model

from .common import Index, lab_rooms, lab_starts, lab_teacher, lecture_rooms, rest_segments, room_uses
from .models import CollegeData, Entry, SolveStats

MAX_CONSECUTIVE = 3  # a teacher teaching more periods in a row than this is penalised

# Weight per unit of each soft-rule penalty. Higher = more important.
WEIGHTS = {
    "subject_repeats_same_day": 10,
    "teacher_long_runs": 5,
    "student_gaps": 4,
    "teacher_load_imbalance": 2,
}

# Groups of hard rules that diagnosis can switch off one at a time.
RELAXABLE = (
    "classrooms", "lab_rooms", "teachers", "teacher_availability", "teacher_daily_max", "sections",
)

Key = tuple[str, int, int]  # (resource id, day, period)


def default_workers() -> int:
    """Search threads. 8 suits a laptop; on a tiny server (Render free has ~0.1 CPU)
    2 finds far better timetables in the same time, and 8 may find none.
    Set SOLVER_WORKERS in the server's environment."""
    try:
        return max(1, int(os.getenv("SOLVER_WORKERS", "8")))
    except ValueError:
        return 8


@dataclass
class Outcome:
    status: str  # CP-SAT status name: OPTIMAL, FEASIBLE, INFEASIBLE, UNKNOWN, MODEL_INVALID
    entries: list[Entry]
    stats: SolveStats | None


def _exactly(m: cp_model.CpModel, lits: Sequence[cp_model.IntVar], n: int) -> None:
    if lits:
        m.Add(sum(lits) == n)
    elif n:
        m.AddBoolOr([])  # nothing can satisfy this: the model is infeasible


def solve_model(
    data: CollegeData,
    time_limit_seconds: float,
    relax: frozenset[str] = frozenset(),
    optimize: bool = True,
    workers: int | None = None,
) -> Outcome:
    idx = Index(data)
    s = data.settings
    days, periods = len(s.days), s.periods_per_day
    m = cp_model.CpModel()

    sec_occ: dict[Key, list[cp_model.IntVar]] = defaultdict(list)
    tea_occ: dict[Key, list[cp_model.IntVar]] = defaultdict(list)
    room_occ: dict[Key, list[cp_model.IntVar]] = defaultdict(list)
    sessions_per_day: dict[tuple[int, int], list[cp_model.IntVar]] = defaultdict(list)
    lectures: list[tuple[cp_model.IntVar, int, int, int, str]] = []
    labs: list[tuple[cp_model.IntVar, int, int, int, str, int]] = []

    for ai, a in enumerate(data.assignments):
        sec, sub = idx.sections[a.section_id], idx.subjects[a.subject_id]

        if sub.lecture_hours:
            lits = []
            for r in lecture_rooms(data, sec):
                for d in range(days):
                    for p in range(periods):
                        x = m.NewBoolVar(f"lec_{ai}_{d}_{p}_{r.id}")
                        lits.append(x)
                        lectures.append((x, ai, d, p, r.id))
                        sec_occ[sec.id, d, p].append(x)
                        tea_occ[a.teacher_id, d, p].append(x)
                        room_occ[r.id, d, p].append(x)
                        sessions_per_day[ai, d].append(x)
            _exactly(m, lits, sub.lecture_hours)

        if sub.lab_hours:
            b = sub.lab_block_length
            lits = []
            for r in lab_rooms(data, sec, sub):
                for d in range(days):
                    for start in lab_starts(s, b):
                        z = m.NewBoolVar(f"lab_{ai}_{d}_{start}_{r.id}")
                        lits.append(z)
                        labs.append((z, ai, d, start, r.id, b))
                        sessions_per_day[ai, d].append(z)
                        for p in range(start, start + b):
                            sec_occ[sec.id, d, p].append(z)
                            tea_occ[lab_teacher(a), d, p].append(z)
                            room_occ[r.id, d, p].append(z)
            _exactly(m, lits, sub.lab_hours // b)

    # ---- Hard rules: nobody and nothing is in two places at once ----
    if "sections" not in relax:
        for lits in sec_occ.values():
            m.AddAtMostOne(lits)
    if "teachers" not in relax:
        for lits in tea_occ.values():
            m.AddAtMostOne(lits)
    uses = room_uses(data)
    for (rid, _, _), lits in room_occ.items():
        group = "lab_rooms" if uses[idx.rooms[rid].type] == "lab" else "classrooms"
        if group not in relax:
            m.AddAtMostOne(lits)
    if "teacher_availability" not in relax:
        for t in data.teachers:
            for slot in t.unavailable:
                for x in tea_occ.get((t.id, idx.day_pos[slot.day], slot.period - 1), []):
                    m.Add(x == 0)
    if "teacher_daily_max" not in relax:
        for t in data.teachers:
            if t.max_periods_per_day is not None:
                for d in range(days):
                    day_lits = [x for p in range(periods) for x in tea_occ.get((t.id, d, p), [])]
                    if day_lits:
                        m.Add(sum(day_lits) <= t.max_periods_per_day)

    # ---- Soft rules ----
    terms: dict[str, list[cp_model.IntVar]] = {k: [] for k in WEIGHTS}
    if optimize:
        # 1. Spread: each extra session of the same subject on one day is penalised.
        for lits in sessions_per_day.values():
            extra = m.NewIntVar(0, len(lits), "")
            m.Add(extra >= sum(lits) - 1)
            terms["subject_repeats_same_day"].append(extra)

        segments = rest_segments(s)
        for t in data.teachers:
            busy = {
                (d, p): sum(tea_occ.get((t.id, d, p), [])) for d in range(days) for p in range(periods)
            }
            if not any(tea_occ.get((t.id, d, p)) for d in range(days) for p in range(periods)):
                continue
            loads = []
            for d in range(days):
                load = m.NewIntVar(0, periods, "")
                m.Add(load == sum(busy[d, p] for p in range(periods)))
                loads.append(load)
                # 3. Long runs: more than MAX_CONSECUTIVE periods in a row (any break resets the run).
                for seg in segments:
                    for w in range(seg.start, seg.stop - MAX_CONSECUTIVE):
                        window = [busy[d, q] for q in range(w, w + MAX_CONSECUTIVE + 1)]
                        over = m.NewBoolVar("")
                        m.Add(over >= sum(window) - MAX_CONSECUTIVE)
                        terms["teacher_long_runs"].append(over)
            # 2. Balance: busiest day minus lightest day.
            hi, lo = m.NewIntVar(0, periods, ""), m.NewIntVar(0, periods, "")
            m.AddMaxEquality(hi, loads)
            m.AddMinEquality(lo, loads)
            spread = m.NewIntVar(0, periods, "")
            m.Add(spread == hi - lo)
            terms["teacher_load_imbalance"].append(spread)

        # 4. Student gaps: a free period with classes both earlier and later that day.
        for sec in data.sections:
            for d in range(days):
                occ = [sum(sec_occ.get((sec.id, d, p), [])) for p in range(periods)]
                for p in range(1, periods - 1):
                    before, after, gap = m.NewBoolVar(""), m.NewBoolVar(""), m.NewBoolVar("")
                    for q in range(p):
                        m.Add(before >= occ[q])
                    for q in range(p + 1, periods):
                        m.Add(after >= occ[q])
                    m.Add(gap >= before + after - occ[p] - 1)
                    terms["student_gaps"].append(gap)

        m.Minimize(sum(WEIGHTS[k] * sum(v) for k, v in terms.items() if v))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_workers = workers or default_workers()
    status = solver.Solve(m)
    name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return Outcome(name, [], None)

    entries: list[Entry] = []
    for x, ai, d, p, rid in lectures:
        if solver.Value(x):
            a = data.assignments[ai]
            entries.append(Entry(
                day=s.days[d], period=p + 1, section_id=a.section_id, subject_id=a.subject_id,
                teacher_id=a.teacher_id, room_id=rid, kind="lecture",
            ))
    for z, ai, d, start, rid, b in labs:
        if solver.Value(z):
            a = data.assignments[ai]
            for p in range(start, start + b):
                entries.append(Entry(
                    day=s.days[d], period=p + 1, section_id=a.section_id,
                    subject_id=a.subject_id, teacher_id=lab_teacher(a), room_id=rid, kind="lab",
                ))
    day_pos = {name: i for i, name in enumerate(s.days)}
    entries.sort(key=lambda e: (day_pos[e.day], e.period, e.section_id))

    stats = SolveStats(
        solver_status=name,
        optimal=status == cp_model.OPTIMAL,
        wall_time_seconds=round(solver.WallTime(), 2),
        score=int(solver.ObjectiveValue()) if optimize else 0,
        penalties={k: int(sum(solver.Value(v) for v in vs)) for k, vs in terms.items()},
    )
    return Outcome(name, entries, stats)
