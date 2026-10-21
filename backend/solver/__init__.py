"""Timetable solver (OR-Tools CP-SAT).

Pure module: college data in, timetable out. Must not import FastAPI or
anything web-related, so it can be tested and reused on its own.
"""

from .checker import check_timetable
from .cpsat import solve_model
from .diagnose import diagnose
from .models import CollegeData, Problem, SolveResult
from .precheck import find_shortages, validate_data
from .sample_data import sample_college

__all__ = ["CollegeData", "SolveResult", "check_timetable", "sample_college", "solve"]


def solve(data: CollegeData, time_limit_seconds: float = 10.0) -> SolveResult:
    """Make a clash-free timetable, or explain why none is possible."""
    problems = validate_data(data)
    if problems:
        return SolveResult(status="invalid", problems=problems)

    problems = find_shortages(data)
    if problems:
        return SolveResult(status="infeasible", problems=problems)

    out = solve_model(data, time_limit_seconds)
    if out.status in ("OPTIMAL", "FEASIBLE"):
        return SolveResult(
            status="solved",
            entries=out.entries,
            stats=out.stats,
            check=check_timetable(data, out.entries),
        )
    if out.status == "INFEASIBLE":
        return SolveResult(status="infeasible", problems=diagnose(data))
    return SolveResult(
        status="timeout",
        problems=[Problem(
            kind="timeout",
            message=f"No timetable was found within {time_limit_seconds:g} seconds.",
            suggestion="Try again with a longer time limit. If it keeps happening, the "
            "college is probably very close to full: add a room or reduce hours.",
        )],
    )
