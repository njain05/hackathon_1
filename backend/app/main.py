"""FastAPI entry point for the college timetable backend."""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from solver import CollegeData, SolveResult, precheck, sample_college, solve
from solver.models import Problem

load_dotenv()

app = FastAPI(title="College Timetable API")

# Comma-separated list of allowed frontend origins, e.g.
# "http://localhost:3000,https://your-app.vercel.app"
origins = [
    o.strip()
    for o in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sample", response_model=CollegeData)
def sample() -> CollegeData:
    """A ready-made sample college, used to prefill the admin screens."""
    return sample_college()


class CheckResult(BaseModel):
    ok: bool
    problems: list[Problem]


@app.post("/check", response_model=CheckResult)
def check(data: CollegeData) -> CheckResult:
    """Quick pre-generation checks: broken data and impossible setups, in plain words."""
    problems = precheck(data)
    return CheckResult(ok=not problems, problems=problems)


# Plain `def` (not async): FastAPI runs it in a worker thread, so a long solve
# doesn't block other requests.
@app.post("/generate", response_model=SolveResult)
def generate(
    data: CollegeData,
    time_limit: float = Query(10.0, ge=1, le=60, description="Solver time limit in seconds"),
) -> SolveResult:
    """Generate a clash-free timetable, or explain why none is possible."""
    return solve(data, time_limit_seconds=time_limit)
