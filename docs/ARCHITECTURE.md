# Architecture

How College Timetable is put together: the parts, the data, who can do what, and how each main flow works from click to database. For *why* each choice was made, see [context.md](../context.md) ("Key decisions").

## 1. The big picture

```mermaid
flowchart TB
    subgraph People["People (phones and laptops)"]
        Dean
        HOD
        Incharge["Timetable in-charge"]
        Teacher
        Student
        Club["Club / organiser (no account)"]
    end

    subgraph Vercel["Vercel: frontend/ (Next.js 16, React, Tailwind v4)"]
        Pages["Pages: /login /today /setup /timetable /my /teacher /hod /department /people /book /approvals /events /reports …"]
        Browser["In the browser: Excel import (SheetJS), instant checks, grid layout, exports (.xlsx, .ics), localStorage"]
    end

    subgraph Render["Render: backend/ (Python, FastAPI)"]
        API["app/: colleges · accounts · members · departments · bookings · changes · ask"]
        Solver["solver/ (pure): precheck → CP-SAT → independent checker → diagnose"]
        Assistant["assistant/ (pure): 6 read-only tools + Claude tool loop"]
    end

    DB[("Postgres on Supabase (SQLite locally)")]
    Claude["Anthropic API: Claude Haiku"]

    People -->|HTTPS| Pages
    Pages -->|"JSON over HTTPS (NEXT_PUBLIC_API_URL)"| API
    API --> Solver
    API --> Assistant
    Assistant -->|"tool use, backend only"| Claude
    API -->|SQLAlchemy| DB
```

- **Two deployables.** The frontend is a static and client-rendered Next.js app on Vercel. The backend is one FastAPI service on Render. Every push to `main` redeploys both.
- **Two pure Python modules.** `backend/solver/` (timetable in, timetable out) and `backend/assistant/` (question in, answer out) import no FastAPI, HTTP or database code, so they're tested on their own.
- **One database.** Postgres on Supabase in production (`DATABASE_URL`), a SQLite file locally. Most college data is stored as JSON, so the model grows without migrations.

## 2. Repository layout

```
frontend/                 Next.js app (Vercel, root directory = frontend)
  app/                    one folder per page (route)
  components/             UI by area: setup, timetable, account, bookings, changes, department, people, reports, today, share, ui
  lib/                    API clients, browser storage, data helpers (types.ts mirrors solver/models.py)
  e2e/                    Playwright tests in a real browser
backend/                  FastAPI service (Render)
  app/                    HTTP routes, database models, access checks
  solver/                 the timetable engine (pure)
  assistant/              "Ask the timetable" (pure)
  tests/                  pytest
  seed_demo.py            makes the public demo college and its five sign-ins
docs/                     this file, screenshots, test cases, demo data
render.yaml               the Render blueprint
```

## 3. Frontend

### Pages and who sees them

Everyone signs in on **/login** with a college code, username and password. The top bar then shows only that person's pages; the server checks access on every request, so hiding a link is a convenience, not the protection.

| Page | Who | What it does |
|---|---|---|
| `/` | Everyone | One **Sign in** start, "New college? Set it up", and "Book a room" for clubs |
| `/login`, `/account` | Everyone | Sign in (with evaluator demo buttons), change your password |
| `/today` | Dean | To-do list: publishing, leave waiting, classes needing cover, bookings waiting |
| `/setup` | Dean (or whoever creates a new college) | 6-step wizard, Excel import and export, checks, Generate, Save online |
| `/timetable` | Dean | Every section, teacher and room; quality score; publish, unpublish, Excel export, print |
| `/reports` | Dean | Teacher workload, room usage, section load |
| `/people` | Dean | Make, reset and remove everyone's sign-ins |
| `/changes` | Dean | Leave, substitutes, cancelled and extra classes for any date |
| `/approvals` | Dean, HOD, approvers | Room and hall requests waiting for them |
| `/hod` | HOD | Department data review, leave approval and cover, room requests |
| `/department` | HOD, in-charge | Edit only their department's rows, ask for rooms, send to the HOD |
| `/teacher` | Teacher | Their classes, leave requests, room bookings |
| `/my` | Student (and teachers, visitors with a share link) | Today (now and next), the week, changes, add to calendar, Ask |
| `/book`, `/track/[token]`, `/events` | Anyone | Book a free room, follow the approval, see the events calendar |
| `/c/[code]` | Anyone | Public share link: opens that college's published timetable on /my |

### What the browser keeps

The frontend has no server-side sessions. After sign-in it keeps a few things in `localStorage` (all through `lib/local.ts`, which is safe when storage is blocked):

| Key | Holds | Written by |
|---|---|---|
| `timetable.account.v1` | Who is signed in: username, name, role, college | `lib/accounts.ts` |
| `timetable.admin.v1` | The Dean's college code and admin key | sign-in as Dean, or the admin link |
| `timetable.member.v1` | An HOD's, in-charge's or teacher's member key | sign-in as that role |
| `timetable.college.v1`, `timetable.me.v1` | The college being viewed and "my section / my name" | sign-in, share link |
| `timetable.setup.v1`, `timetable.result.v1` | The setup draft and the last generated timetable (Dean) | `lib/store.tsx`, `lib/result.ts` |

Signing out clears all of them, so a shared laptop keeps nothing of the last person.

### Main frontend modules

| Module | Role |
|---|---|
| `lib/api.ts` | One `call()` for every request: wakes a sleeping server, retries once, turns errors into plain-English messages |
| `lib/accounts.ts` | `signIn`, `signOut`, `changePassword`, `useAccount`, `homeFor(role)`, and the Dean's sign-in management calls |
| `lib/access.ts` | `useAccess()`: is this device staff (the Dean, or someone creating a new college) |
| `lib/tables.ts` | **One column spec per table**, which drives the on-screen table, Excel/CSV templates, import and paste |
| `lib/excel.ts` | Workbook templates, import (add, update or replace) and export, all in the browser |
| `lib/checks.ts` | Instant checks while typing (missing codes, duplicates, load warnings) |
| `lib/grid.ts`, `lib/periods.ts` | Entries → day rows with breaks, merged lab blocks, clock times, subject colours |
| `lib/cloud.ts` | Save online, autosave (with a stale-copy guard), publish, and the cached published timetable for offline viewing |
| `lib/demo.ts` | The public demo college's sign-ins for evaluators (`NEXT_PUBLIC_DEMO_LOGINS` overrides) |

## 4. Backend

### Modules

| Module | Responsibility |
|---|---|
| `app/main.py` | App, CORS (`FRONTEND_ORIGINS`), `/health`, `/health/db`, `/sample`, `/check`, `/generate` |
| `app/db.py` | SQLAlchemy models and the engine (`DATABASE_URL`, SQLite by default) |
| `app/colleges.py` | Create a college, autosave the draft, publish, unpublish, public read |
| `app/accounts.py` | Sign-in, passwords, lockout, the Dean's account management |
| `app/members.py` | Member keys for HODs, in-charges and teachers (`X-Member-Key`) |
| `app/departments.py` | Department-scoped setup saves, submit → HOD review, room-sharing requests |
| `app/bookings.py` | Room availability, requests, approval chains, events calendar |
| `app/changes.py` | Leave, cover suggestions, substitutes, cancelled and extra classes, the actual day |
| `app/ask.py` | "Ask the timetable": rate limits, status, calls `assistant/` |
| `solver/` | `models.py` (Pydantic input/output), `precheck.py`, `cpsat.py`, `checker.py`, `diagnose.py`, `sample_data.py` |
| `assistant/` | `tools.py` (6 tools over the real day), `chat.py` (Claude tool loop) |

### API at a glance

About 60 routes, all documented live at `<backend>/docs`. They group like this:

| Group | Examples | Who may call |
|---|---|---|
| Engine | `POST /generate`, `POST /check`, `GET /sample` | Anyone (no data is stored) |
| College | `POST /colleges`, `PUT /colleges/{ref}/data`, `POST /colleges/{ref}/publish`, `DELETE /colleges/{ref}/timetable` | Dean (`X-Admin-Key`) |
| Public read | `GET /colleges/{ref}`, `GET /colleges/{ref}/timetable`, `/day`, `/events`, `/availability` | Anyone |
| Accounts | `POST /colleges/{ref}/login`, `/password`, `/accounts`, `/accounts/bulk`, `/accounts/{username}/reset` | Sign-in: anyone; managing: Dean (an HOD can make their in-charge) |
| Departments | `GET/PUT /departments/{dept}/setup`, `/submit`, `/review`, `/room-requests` | In-charge, HOD (`X-Member-Key`), Dean |
| Leave and cover | `/leaves`, `/leaves/{id}/decide`, `/cover`, `/changes`, `/rules` | Teacher asks; HOD or Dean decides; Dean or HOD covers |
| Bookings | `POST /bookings`, `/approvals`, `/approvals/{id}`, `/bookings/{token}` | Anyone requests; approvers decide (`X-Approver-Key`, member or admin key) |
| Assistant | `POST /colleges/{ref}/ask`, `GET /assistant/status` | Anyone, rate-limited |

### How access works

```mermaid
flowchart LR
    Login["POST /colleges/{ref}/login<br/>username + password"] --> Check{"scrypt hash matches?<br/>(5 wrong tries → 5-minute lock)"}
    Check -- no --> Wrong["401: Wrong username or password"]
    Check -- yes --> Role{role}
    Role -- Dean --> AK["unseal the admin key → browser keeps it<br/>sends X-Admin-Key"]
    Role -- "HOD / in-charge / teacher" --> MK["unseal the member key → browser keeps it<br/>sends X-Member-Key"]
    Role -- Student --> SEC["no key: college code + section<br/>(the published timetable is public)"]
```

- **Passwords** are stored only as scrypt hashes with a per-account salt.
- **Each staff account seals its access key with the password.** Signing in hands the browser exactly the key the existing endpoints already check (`X-Admin-Key` or `X-Member-Key`). The server stores only key *hashes* for checking, and can't read a sealed key without the password.
- **Every write is checked on the server.** For example, a department save keeps only that department's rows, an HOD can decide only their department's leave, and a booking step can be approved only by its own approver while the request waits there.
- **Secrets stay on the server.** `DATABASE_URL` and `ANTHROPIC_API_KEY` live only in Render's environment; nothing secret is in a `NEXT_PUBLIC_` variable.

## 5. The timetable engine

```mermaid
flowchart LR
    In["CollegeData<br/>(settings, rooms, teachers,<br/>sections, subjects, assignments,<br/>electives)"] --> Pre["precheck.py<br/>invalid codes, overloads,<br/>room shortages"]
    Pre -- problems --> Explain["status invalid / infeasible<br/>+ plain-English fixes"]
    Pre -- ok --> CP["cpsat.py<br/>OR-Tools CP-SAT<br/>hard rules = constraints<br/>soft rules = weighted penalties"]
    CP -- solution --> Chk["checker.py<br/>independent re-check<br/>(no shared code)"]
    CP -- "no solution" --> Diag["diagnose.py<br/>re-solve with one rule group<br/>switched off at a time"]
    Diag --> Explain
    Chk --> Out["SolveResult<br/>entries · stats · score · check report"]
```

- **Hard rules** (never broken): no teacher, section or room double-booked; labs as consecutive blocks in the right lab type, never across a break unless allowed; rooms big enough; exact weekly hours; nothing in a break; teacher unavailable times and daily/weekly caps; event halls never used for classes; department rooms only for their department (or departments it shares with).
- **Soft rules** (weighted penalties, explained on screen): subject twice in a day (10), long teaching runs (5), student gaps (4), uneven teacher days (2).
- **Labs are one variable per block** (start slot + length), so consecutive lab periods hold by construction. Lab batches get their own block variables.
- **Speed:** `POST /generate?time_limit=10` by default. `SOLVER_WORKERS` sets the search threads (2 on Render's free plan, which has about a tenth of a CPU).
- **The checker runs again before every publish and on every daily change**, so students never see a timetable with a clash.

## 6. Data model

College setup data (`CollegeData`) is one JSON document per college; the tables below hold everything around it.

```mermaid
erDiagram
    colleges ||--o| college_data : "setup draft (JSON)"
    colleges ||--o{ timetables : "published versions (CollegeData + SolveResult)"
    colleges ||--o{ accounts : "sign-ins"
    colleges ||--o{ members : "HOD / in-charge / teacher keys"
    accounts }o--o| members : "staff account holds that key"
    colleges ||--o{ department_reviews : "submit → approve / return"
    colleges ||--o{ room_requests : "room sharing between departments"
    colleges ||--o{ approval_steps : "booking approval chain"
    colleges ||--o{ bookings : "room requests"
    bookings ||--o| booking_routes : "its approvers, in order (HOD → Dean)"
    bookings ||--o{ booking_actions : "each signature"
    colleges ||--o| college_rules : "cover rules"
    colleges ||--o{ leaves : "teacher leave"
    colleges ||--o{ day_changes : "substitute / cancel / extra"
    leaves ||--o{ day_changes : "cover for"

    colleges {
        string code "6 letters, public"
        string slug "share link"
        string admin_key_hash
    }
    accounts {
        string username "unique per college"
        string role "dean, hod, incharge, teacher, student"
        string password_hash "scrypt"
        string key_box "sealed access key"
    }
    timetables {
        int version
        json data
        json result
    }
```

**A day's real timetable** = the published weekday + that date's `day_changes`, re-checked by the independent checker. The published timetable itself never changes for leave.

## 7. Main flows

### Set up, generate and publish (Dean)

```mermaid
sequenceDiagram
    actor Dean
    participant FE as Frontend
    participant API as FastAPI
    participant S as solver
    participant DB as Database

    Dean->>FE: 6-step setup or Excel import
    FE->>FE: instant checks while typing
    FE->>API: POST /check
    API->>S: precheck
    Dean->>FE: Generate timetable
    FE->>API: POST /generate
    API->>S: precheck → CP-SAT → checker
    S-->>FE: SolveResult ("Verified: 0 clashes", score)
    Dean->>FE: Save online & share, choose username + password
    FE->>API: POST /colleges, then /accounts/dean
    FE->>API: PUT /colleges/{ref}/data (autosave, X-Based-On guard)
    Dean->>FE: Publish timetable
    FE->>API: POST /colleges/{ref}/publish
    API->>S: checker again
    API->>DB: new timetable version
```

### Departments prepare their own data

```mermaid
sequenceDiagram
    actor IC as In-charge
    actor HOD
    actor Dean
    participant API as FastAPI

    IC->>API: PUT /departments/CSE/setup (only CSE rows are kept)
    IC->>API: POST /departments/CSE/submit
    HOD->>API: POST /departments/CSE/review (approve, or return with a note)
    Dean->>API: Generate once every department is approved (or "Generate anyway")
```

### Leave and cover

```mermaid
sequenceDiagram
    actor T as Teacher
    actor HOD
    participant API as FastAPI
    actor S as Students

    T->>API: POST /leaves (whole day or some periods)
    HOD->>API: POST /leaves/{id}/decide (approve)
    HOD->>API: GET /cover (ranked substitutes: same subject → same department → anyone free)
    HOD->>API: POST /changes (substitute or cancel), checked by the independent checker
    S->>API: GET /day → today's classes with the change shown
```

### Booking a room

```mermaid
sequenceDiagram
    actor O as Teacher or club
    participant API as FastAPI
    actor A as Approvers (HOD → Dean)

    O->>API: GET /availability (only free periods: no class, no booking)
    O->>API: POST /bookings → tracking link
    A->>API: POST /approvals/{id} (in order, clashes checked again)
    O->>API: GET /bookings/{token} ("Waiting for Dean since 2 hours")
    Note over API: Approved events appear on /events
```

### Ask the timetable

```mermaid
sequenceDiagram
    actor U as Student or teacher
    participant API as /colleges/{ref}/ask
    participant AS as assistant/
    participant C as Claude Haiku

    U->>API: "Where is my next class?"
    API->>API: rate limits (8/min, 60/h per IP, 600/h overall)
    API->>AS: question + who is asking + local time
    AS->>C: question + 6 tool definitions
    C-->>AS: tool call, e.g. whats_next("me")
    AS->>AS: run the tool on the real day (published + changes)
    AS-->>C: tool result (at most 4 rounds)
    C-->>API: 1–3 sentence answer from tool results only
```

The six tools are `get_schedule`, `whats_next`, `free_rooms`, `teacher_free_slots`, `hall_free_slots` and `explain_problems`. Without `ANTHROPIC_API_KEY` the box is hidden, and the rest of the app is unaffected.

## 8. Deployment and configuration

```mermaid
flowchart LR
    GH["GitHub: main"] -->|push| V["Vercel<br/>frontend/ (Next.js build)"]
    GH -->|push| R["Render<br/>backend (render.yaml, Python)"]
    R --> SB[("Supabase Postgres<br/>Session pooler")]
    R -.->|optional| AN["Anthropic API"]
```

| Where | Variable | Purpose |
|---|---|---|
| Vercel | `NEXT_PUBLIC_API_URL` | The Render URL; baked in at build time |
| Vercel | `NEXT_PUBLIC_DEMO_LOGINS` | Optional: override the evaluator demo sign-ins (JSON) |
| Render | `FRONTEND_ORIGINS` | Comma-separated CORS origins (the Vercel URL, plus localhost for development) |
| Render | `DATABASE_URL` | Supabase Session pooler URI; unset = SQLite (wiped on Render restarts) |
| Render | `SOLVER_WORKERS` | CP-SAT threads (2 on the free plan) |
| Render | `ANTHROPIC_API_KEY` | Optional: turns on "Ask the timetable" |

The free Render server sleeps after about 15 minutes; the frontend shows "Waking up the server" and retries. Generating takes about 20 s for the sample college and about 60 s for the larger demo college there (about 5–20 s on a laptop).

## 9. Testing

| Suite | Command | Covers |
|---|---|---|
| Backend (97 tests) | `cd backend && .venv/bin/python -m pytest -q` | Solver, independent checker, every API group, accounts and lockout, departments, bookings, leave and cover, short days and lab batches, the assistant's tools |
| Frontend checks | `cd frontend && npm run lint && npm run build` | Strict TypeScript, ESLint, a production build |
| Browser (16 tests) | `cd frontend && npm run e2e` | Main flows, department review, lab batches, reports and exports, every page on desktop and a 375 px phone |
| Demo cases | `cd backend && .venv/bin/python demo_checks.py` | 22 numbered cases with evidence ([DEMO_TESTCASES.md](DEMO_TESTCASES.md)) |
