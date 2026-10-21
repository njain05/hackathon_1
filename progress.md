# Progress log

Update after every completed step. Newest entries at the top of each section.

## Done
- **2026-10-21: Timetable views (`/timetable`, `/my`)**
  - **Generate** (Check step) shows a loading message while the solver runs, saves the result in browser storage (`timetable.result.v1`, with a snapshot of the data it was made from) and opens `/timetable`. If the solve fails, the backend's plain-English problems appear with "Fix in <step>" buttons.
  - **/timetable**:
    - a green "Verified: 0 clashes" badge from the independent checker (teacher, section and room clash counts);
    - the quality score with each penalty explained in plain words;
    - switching between by section, by teacher and by room, each with a dropdown (seminar halls and auditoriums are left out because they never hold classes);
    - Print this timetable, and Print all (one A4 landscape page each, no buttons or navigation).
  - **Grid**:
    - days × periods from the data, with breaks as columns showing real clock times (`dayBlocks`);
    - each subject gets its own colour (12 tints, `--color-subject-N` in globals.css);
    - a lab is one merged block, including across a break labs may cross, but never across lunch or past its block length;
    - each cell shows subject, plus teacher and room, section and room, or section and teacher, depending on the view;
    - a subject key with weekly periods sits underneath.
  - **Phones**: a day-by-day list replaces the grid below 768px.
  - **/my**:
    - "I'm a student / I'm a teacher", then pick a section or name (remembered in this browser);
    - a Today card with Now (class, break, free, done) and Next, with minutes left;
    - the week grid with today's row highlighted and the current class outlined.
    - `?now=Monday 10:15` in the address bar fakes the clock for demos.
  - **Tested in the browser**:
    - Sample college: Generate → /timetable, all 3 views, quality panel.
    - Admin-edited setup: 08:30 start, 60-minute periods, lunch after period 3, no tea break. Times followed the data.
    - **6-day week**: Saturday row, 115 periods, 0 clashes; a lab merges across the tea break.
    - /my at Monday 10:15 (lab now, ends in 15 min), Monday 12:00 ("Lunch until 12:30"), Sunday ("No classes today", first class Monday), and the teacher role.
    - Phone list at 375px with no sideways scroll.
    - Print: all = 5 pages, this = 1.
  - Lint, type check and build pass; 26 backend tests pass.
- **2026-10-21: Working days and tea break are the admin's choice**
  - Week step: Mon–Sun day buttons (tap to select; no tick marks, by request) and quick choices "5-day week (Mon–Fri)" and "6-day week (Mon–Sat)". The matching one is highlighted.
  - Templates no longer assume any working days. Until days are chosen, the step shows "Choose the days your college has classes" and the Check step blocks generation.
  - Tea break is now optional. It defaults to "No tea break". Choosing one sets the period and minutes, plus "A lab session can run straight across this break". Removed from the Engineering template defaults.
  - Advanced "Other breaks" now covers extra breaks only (prayer, assembly…).
  - Checked: 26 backend tests, lint, type check, production build. In the browser: presets, custom day picks, and adding a tea break shown in the day preview.
- **2026-10-21: Admin setup wizard (`/setup`)**
  - **First use**: pick a template (Engineering, Arts & Science, Start from scratch) or "Load sample college" (from `GET /sample`).
  - **6 steps** in a period-strip stepper, each with a hint: College & week → Rooms → Teachers → Sections → Subjects (+ who teaches what) → Check & generate.
  - **Week step**: days, periods, start time, period length, lunch. A to-scale "Your day" preview with real clock times. Advanced: extra breaks (labs continue?), different period lengths. Departments table.
  - **Every table** supports:
    - add and delete rows, edited like a spreadsheet;
    - **Ctrl+V of rows copied from Excel** (or a paste box);
    - **Import Excel/CSV** for that step;
    - download template (workbook or CSV);
    - an "Advanced options" toggle for rare columns.
  - **Whole-workbook** download and import, with a "How to use" sheet.
  - **Import rules**: header aliases are recognised. Bad rows are skipped and listed as sheet, row, reason and fix. The same code updates a row; a new code adds one.
  - Renaming a code updates every reference (e.g. teacher HK → HKR moves their classes).
  - **Check & generate** shows:
    - instant browser checks (missing, duplicate or blank entries; labs with no lab room);
    - then server `POST /check` (impossible setups, e.g. not enough lab time, teacher overloaded);
    - each problem with a "Fix in <step>" button;
    - load bars per teacher and section;
    - the Generate button.
  - The draft is saved in browser storage.
- **2026-10-21: Data model made fully data-driven** (backend + solver):
  - breaks list with `labs_continue`;
  - `day_start`, `period_minutes`, `period_lengths`;
  - admin-defined `room_types` with a use;
  - `subject.lab_room_type` (replaces `lab_room_ids`);
  - `teacher.unavailable` (enforced by the solver, checker and pre-checks);
  - `Problem.step`;
  - `POST /check`.
  - The sample now uses human codes (HK, CSE-3A, CS201, C-101) and has a tea break that labs may cross. 26 backend tests pass.
- **2026-10-21: Theme**:
  - Palette from the brief: cream #FEF9F2, blue #789DBC, pink #FFE3E3, mint #C9E9D2. Navy #3B5F80 and ink #1F2A37 added for readable text and buttons.
  - Font: Atkinson Hyperlegible Next.
  - Verified in the browser:
    - Template → paste → workbook import (78 rows; 3 planted bad rows reported) → checks → Generate: 115 periods, 0 clashes.
    - Download → re-import round trip: 80 updated, 0 errors.
    - Rename propagation; availability parsing and errors.
    - Infeasible setup explained with "Fix in Rooms".
    - Phone width 375px with no sideways scroll.
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
1. Simple hall booking (free slots only, one-click approve), then an "Ask the timetable" box.
2. Deploy: backend on Render (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`), frontend on Vercel with `NEXT_PUBLIC_API_URL`.

## Problems & fixes
- Tailwind v4 only outputs `@theme` variables that a utility class uses. The subject colours are read with `var()` from inline styles, so they were dropped. Fixed by moving them to plain `:root` variables.
- Turbopack again kept serving stale CSS after a `globals.css` edit, and a dev-server restart fixed it. **If a CSS change doesn't show up, restart `npm run dev`.**
- The print preview itself wasn't checked here (the browser's print dialog can't be opened from the test tools). The print markup and page breaks were checked in the page instead. Do a real print preview before the demo.
- Tailwind v4 silently dropped classes defined with `@apply` inside `@layer components`. Fixed by using `@utility btn-primary { ... }`.
- The Next dev server (Turbopack) once kept serving stale CSS after `globals.css` changed. A restart fixed it.
- `create-next-app`'s `.gitignore` pattern `.env*` also hid `.env.local.example`. Fixed earlier with `!.env*.example`.
- `npm audit` reports a high-severity `braces` issue in build tooling only (not shipped to the browser). Left for now; check again before deploying.
- The SheetJS `activeTab` workbook view works but is missing from its TypeScript types, so it is cast with a comment.
- Starlette's TestClient warned that `httpx` is deprecated, so the dev dependencies use `httpx2` instead.
- Teacher load imbalance is the only non-zero penalty on the sample. It counts days off as 0 load, so a teacher with 6 periods a week can't be perfectly even. This is expected and not a bug.
- `create-next-app` made its own `.git` inside `frontend/`. Removed it so the repo has a single git root.
- `frontend/.gitignore` ignored `.env*`, which also hid `.env.local.example`. Added `!.env*.example`.
- Python: use Homebrew's `/opt/homebrew/bin/python3.14` (3.14.8). The old python.org 3.14.0 is still earlier in PATH as `python3`, so create venvs with the full path. **Don't move to 3.15 until OR-Tools ships 3.15 support.** `backend/.python-version` = 3.14.8 for Render (if Render lacks it, set `PYTHON_VERSION=3.12`; nothing in the code needs 3.14).
