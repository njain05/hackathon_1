"""FastAPI entry point for the college timetable backend."""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from sqlalchemy.exc import SQLAlchemyError

from app import db
from app.bookings import router as bookings_router
from app.changes import router as changes_router
from app.colleges import database_error, router as colleges_router
from solver import CollegeData, SolveResult, precheck, sample_college, solve
from solver.models import Problem

load_dotenv()  # before the first request: the database connects lazily, reading DATABASE_URL

app = FastAPI(title="College Timetable API")
app.include_router(colleges_router)
app.include_router(bookings_router)
app.include_router(changes_router)
app.add_exception_handler(SQLAlchemyError, database_error)
app.add_exception_handler(db.DatabaseUnavailable, database_error)

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


@app.get("/health/db")
def health_db() -> dict[str, str]:
    """Can the server reach its database? Shows the reason if not (never the password)."""
    return db.status()


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
