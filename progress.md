# Progress log

Update after every completed step. Newest entries at the top of each section.

## Done
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
- Python 3.14 is the only Python on this machine. OR-Tools 9.15 installs and imports fine on it. `backend/.python-version` = 3.14 for Render (if Render lacks 3.14, set `PYTHON_VERSION=3.12` there; nothing in the code needs 3.14).
