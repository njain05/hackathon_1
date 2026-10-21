# Progress log

Update after every completed step. Newest entries at the top of each section.

## Done
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
1. Solver input/output models (Pydantic) in `backend/solver/models.py`, plus a sample college dataset.
2. CP-SAT solver: hard rules first, then soft-rule penalties. Add a validator that re-checks the output for clashes.
3. `POST /timetable/generate` endpoint.
4. Frontend: admin data entry (prefilled sample) → Generate → section/teacher/room grid views.
5. Optional: simple hall booking (free slots only, one-click approve), then an "Ask the timetable" box.

## Problems & fixes
- `create-next-app` made its own `.git` inside `frontend/`. Removed it so the repo has a single git root.
- `frontend/.gitignore` ignored `.env*`, which also hid `.env.local.example`. Added `!.env*.example`.
- Python: use Homebrew's `/opt/homebrew/bin/python3.14` (3.14.8). The old python.org 3.14.0 is still earlier in PATH as `python3`, so create venvs with the full path. **Don't move to 3.15 until OR-Tools ships 3.15 support.** `backend/.python-version` = 3.14.8 for Render (if Render lacks it, set `PYTHON_VERSION=3.12`; nothing in the code needs 3.14).
