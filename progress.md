# Progress log

Update after every completed step. Newest entries at the top of each section.

## Done
- **2026-10-21: Solver + POST /generate**
  - `backend/solver/` is a pure module:
    - models, pre-checks, CP-SAT model, diagnosis, independent clash checker, sample college.
    - `solve(data)` returns a `SolveResult`.
  - Hard rules are all constraints: no teacher, section or room double booking; labs as consecutive blocks in lab rooms that don't cross lunch; capacity; room department; exact weekly hours; optional teacher daily max.
  - Soft rules are weighted penalties: subject repeats on the same day (10), teacher runs longer than 3 periods (5), student gaps (4), teacher busiest-day minus lightest-day (2).
  - Sample college:
    - CSE and ECE, 5 sections, 22 subjects, 14 teachers.
    - Department classrooms, plus a shared lecture theatre, 2 shared computer labs, an ECE-only electronics lab, a seminar hall and an auditorium.
    - Solves **OPTIMAL in about 5 s**: 115 periods, 0 clashes, score 32 (all from teacher load imbalance; 0 gaps, 0 repeats, 0 long runs).
  - Infeasible input gets plain-English problems with suggestions: section or teacher overload, no room big enough, classroom or lab shortage, hidden bottlenecks found by diagnosis, invalid ids.
  - API:
    - `GET /sample` returns the sample college.
    - `POST /generate?time_limit=10` takes CollegeData and returns a SolveResult.
    - Malformed input gets a 422.
  - Tests: 22 pytest tests (solver, checker, API), all passing in about 9 s.
- **2026-10-21: Pushed to GitHub**: private repo https://github.com/njain05/hackathon_1. Checked that no `.env` files are tracked or in the history.
- **2026-10-21: Python upgraded to 3.14.8** (Homebrew). Rebuilt `backend/.venv` on it. OR-Tools 9.15 and `/health` work. Stayed on 3.14 rather than 3.15.0 because OR-Tools has no 3.15 version yet.
- **2026-10-21: Project setup**
  - Wrote CLAUDE.md, context.md (problem, users, data model, hard and soft rules, decisions, roadmap for today and stage 2) and README.md.
  - Root `.gitignore` covers .env files, node_modules, .next, __pycache__ and .venv. Only `*.example` env files are committed.
  - Backend: FastAPI `GET /health` → `{"status":"ok"}`. CORS origins come from `FRONTEND_ORIGINS`. `backend/solver/` is a placeholder package. Dependencies are pinned in requirements.txt (ortools 9.15, fastapi 0.156).
  - Frontend: Next.js 16 + Tailwind v4. The home page calls `${NEXT_PUBLIC_API_URL}/health` and shows a status badge.
  - Checked: the page shows "Backend connected", CORS allows localhost:3000 and not other origins, and lint plus type check pass.
  - `.claude/launch.json` starts both dev servers.
  - Git initialised with the first commit.

## In progress
- (none)

## Next
1. Frontend: admin data entry (prefilled sample) → Generate → section/teacher/room grid views.
2. Optional: simple hall booking (free slots only, one-click approve), then an "Ask the timetable" box.
3. Deploy: backend on Render (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`), frontend on Vercel with `NEXT_PUBLIC_API_URL`.

## Problems & fixes
- Starlette's TestClient warned that `httpx` is deprecated, so the dev dependencies use `httpx2` instead.
- Teacher load imbalance is the only non-zero penalty on the sample. It counts days off as 0 load, so a teacher with 6 periods a week can't be perfectly even. This is expected and not a bug.
- `create-next-app` made its own `.git` inside `frontend/`. Removed it so the repo has a single git root.
- `frontend/.gitignore` ignored `.env*`, which also hid `.env.local.example`. Added `!.env*.example`.
- Python: use Homebrew's `/opt/homebrew/bin/python3.14` (3.14.8). The old python.org 3.14.0 is still earlier in PATH as `python3`, so create venvs with the full path. **Don't move to 3.15 until OR-Tools ships 3.15 support.** `backend/.python-version` = 3.14.8 for Render (if Render lacks it, set `PYTHON_VERSION=3.12`; nothing in the code needs 3.14).
