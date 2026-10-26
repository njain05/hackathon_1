# Context

## Problem
Making a college timetable by hand takes days and still ends up with clashes: a teacher in two rooms at once, a lab booked twice, a section with three free periods in a row. When things change, students hear about it through WhatsApp forwards. Booking a seminar hall needs paper letters passed from desk to desk, and two clubs can still book the same day.

**Pitch:** *Timetables decide everyone's day, so we built one place for the whole college. Admins generate the timetable, teachers and students live by it, and organisers book halls around it without letters.*

Event: Punjab Jobs AI Bootcamp hackathon (J-PAL South Asia). 2-hour build today, then stage 2 (a full, tested product) by Tuesday.
Judging: core functionality (zero clashes), usability (an admin can use it without help), design (easy-to-read timetables), advanced features, and relevance to real college problems.

## Users
| User | Needs |
|---|---|
| **Admin / HOD** | Enter college data, generate a clash-free timetable, fix problems, see reports, approve hall bookings |
| **Teacher** | See their week (classes, rooms, free periods), mark leave, book extra or makeup classes, set preferences |
| **Student** | See their section's day and week, next class, changes, free rooms |
| **Event organiser** (club, society, department) | Book a seminar hall or auditorium in a free slot, track the approval, see the events calendar |

## Data model
Everything about a college comes from the admin's data. Nothing is hard-coded: not days, periods, period lengths, breaks or room types. Codes typed by the admin (CSE, C-101, HK, CSE-3A, CS201) are the ids, so spreadsheets can refer to them.

- **Settings**:
  - `days` (any list, in order) and `periods_per_day`.
  - `day_start` and `period_minutes`, plus optional `period_lengths` when periods differ.
  - `breaks`: name, `after_period`, minutes, and `labs_continue`, which is true when a lab may run across the break (a tea break, for example).
- **Room types** (`room_types`): admin-defined (Classroom, Computer lab, Seminar hall…). Each has a `use`: `lecture`, `lab`, or `event` (never used for classes; kept for bookings).
- **Department**: id (code), name.
- **Section**: id (code), name, department, student strength.
- **Subject**: id (code), name, department, `lecture_hours` and `lab_hours` a week, `lab_block_length` (periods in a row per lab, default 2), optional `lab_room_type` (e.g. labs only in electronics labs).
- **Teacher**:
  - id (short code), name and home department. A teacher can teach any department.
  - Optional `max_periods_per_day` (hard limit).
  - `unavailable`: a list of (day, period) they can't teach, entered as "Mon 1-2, Sat all day".
- **Assignment**: (section, subject, teacher, optional lab teacher). Who teaches what. The lab teacher defaults to the lecture teacher.
- **Room**: id (code), name, type (a room type id), capacity, optional department. If a department is set, only its sections use the room; if not, the room is shared.
- **Timetable (output)**: `SolveResult` contains:
  - status (`solved` | `infeasible` | `invalid` | `timeout`)
  - entries (day, 1-based period, section, subject, teacher, room, kind)
  - problems (message, suggestion and the setup `step` to fix it in)
  - stats and the independent checker's report.
- **Saved college (server)**: `colleges` (name, slug for the share link, 6-letter code, SHA-256 of the admin key), `college_data` (the setup draft as JSON, may be incomplete) and `timetables` (published versions: the CollegeData snapshot + SolveResult). Stored in `backend/app/db.py`, never in the solver.
- **Booking** (`backend/app/bookings.py`, not in the solver):
  - an event room, a date and a period range (inclusive), plus title, purpose, attendees, organiser, club and contact;
  - `status`: `pending` (waiting at approval step `step`) → `approved` / `rejected`, or `cancelled` by the organiser;
  - `approval_steps`: the admin's ordered chain (e.g. HOD, Dean), each with its own secret link. With none set, the admin approves;
  - `booking_actions`: each signature (who, step, note, time).

## Works for any college
- **First use: pick a starting template.**
  - *Engineering college*: 8 × 50 min, lunch after period 4, computer and engineering labs.
  - *Arts & Science college*: 6 × 55 min, lunch after period 3, science and computer labs.
  - *Start from scratch*: 8 periods, lunch after period 4, basic room types.
  - *Load sample college*: a complete, solvable demo.
  - Templates only pre-fill settings. Everything stays editable.
  - **Working days are never assumed.** The admin picks Mon–Sun themselves, with quick choices "5-day week" and "6-day week".
  - **A tea break is optional** ("No tea break" by default). Lunch can also be switched off.
- **Basic up front, rare under "Advanced options".**
  - *Basic*: days, periods, start time, period length, lunch, optional tea break; codes, names, seats, departments, weekly hours.
  - *Advanced*: extra breaks (and whether labs continue across them), different period lengths, room types, a teacher's daily max and unavailable times, lab block length, lab room type, a different lab teacher.

### College variations: designed for, not all built yet
The model is built so each of these is an **additive, optional field**: existing data stays valid, and the solver treats a missing field as "off".

| Variation | Status | How it fits the model |
|---|---|---|
| Breaks of any length, anywhere | **Built** | `settings.breaks[]`, with `labs_continue` per break |
| Periods of different lengths | **Built** | `settings.period_lengths` (clock times only; the solver works in periods) |
| Custom room types | **Built** | `room_types[]` with a `use`; rooms and subjects refer to them by id |
| Teachers shared across departments | **Built** | `department_id` is only the home department; assignments may cross departments |
| Teacher unavailable times | **Built** | `teacher.unavailable[]`: a hard constraint in the solver, also checked by the checker and pre-checks |
| Lab batches (section split into groups) | Planned | `section.batches: [{id, strength}]` + `assignment.lab_by_batch: bool`. Each batch gets its own lab variables. Batches of one section may share a slot in different labs (or rotate subjects), but block the whole section. Capacity is checked per batch. |
| Combined / elective classes across sections | Planned | `assignment.section_ids: [..]` (today's `section_id` becomes the 1-element case) for combined lectures. Electives as `elective_groups: [{sections, options: [assignment…]}]` running in the same slot in parallel rooms. |
| Multiple shifts (morning/evening) | Planned | `settings.shifts: [{id, days, day_start, periods_per_day, breaks}]` + `section.shift_id`. Today's settings become the single default shift. Rooms and teachers are shared across shifts using clock-time overlap. |
| Teacher preferences ("no classes before 10 on Fri") | Planned | `teacher.preferred_off: [slot]` as a soft penalty (unlike the hard `unavailable`) |

## Hard rules (must never break: these are constraints)
1. No **teacher** is double-booked in any (day, period).
2. No **section** is double-booked in any (day, period).
3. No **room** is double-booked in any (day, period).
4. **Labs** are held only in rooms whose type is used for labs (and of the subject's `lab_room_type`, if set), as **consecutive periods** (a block of `lab_block_length`) that don't cross the end of the day or a break, unless that break has `labs_continue`.
5. **Room capacity** ≥ section strength.
6. Exactly the required lecture and lab hours per week are scheduled for every assignment.
7. Nothing is scheduled in a break.
8. **Teacher unavailable times** and **max periods a day** are respected.
9. Lectures only in rooms used for lectures. Rooms used for events (seminar halls, auditoriums) never get classes. Department rooms only for that department.

## Soft rules (preferences: weighted penalties in the objective)
1. **Spread** each subject across the week (avoid the same subject twice in one day).
2. **Balanced teacher load** across days.
3. **Limit consecutive periods** per teacher (e.g. no more than 3 in a row).
4. **Fewer student gaps**: avoid free periods between a section's classes.

## Key decisions
| Decision | Reason |
|---|---|
| OR-Tools **CP-SAT** solver | It guarantees the hard rules are never broken (zero clashes can be proven, not hoped for) and can optimise the soft rules. Free and fast. |
| Separate **Python backend** | OR-Tools is best in Python. FastAPI is quick to build and documents itself (/docs). |
| **Solver as a pure module** (`backend/solver/`) | It can be tested without a server and reused for exam timetables and makeup-class search. |
| Hard rules as constraints, soft rules as **weighted penalties** | We always get a valid timetable when one exists. Preferences only change its quality. |
| Labs modelled as **one block variable** (start slot + length) | Consecutive lab periods hold by construction, with no fragile period-by-period linking. |
| **Generic data model** (days, periods, lunch from settings) | It works for any college, which is a judging requirement. |
| Backend URL and CORS origins from **env vars** | The same code runs locally and on Vercel/Render with no code changes. |
| Next.js + Tailwind on Vercel, FastAPI on Render | Free tiers, fast deploys, a familiar stack. |
| Breaks sit **between periods** (`after_period`) and are not periods themselves | "Nothing in a break" holds by construction, and lab blocks simply can't start where they'd cross one. |
| Seminar halls and auditoriums are **never used for classes** | They stay free for event bookings, which is the organiser feature. |
| Rooms can belong to a **department**, or be shared | Matches real colleges: department blocks plus a shared lecture theatre and computer labs. |
| **Independent clash checker** with no shared code with the solver | A solver bug can't hide itself. It also checks imported or hand-edited timetables later. |
| Failure explained in **two layers**: quick counting pre-checks, then re-solving with one rule group switched off | Pre-checks name the exact short resource instantly. Switching groups off finds hidden bottlenecks (e.g. lunch splitting lab blocks). |
| **Codes are the ids** (CSE, C-101, HK, CSE-3A, CS201) | Admins already use these codes. Spreadsheets refer to them directly. Renaming a code in the UI updates every reference. |
| **One column definition per table** drives the on-screen table, the Excel/CSV template, file import and paste | They can never disagree. Header aliases ("Room no.", "Initials", "L"/"P") let real admin sheets import as they are. |
| Excel/CSV import **runs in the browser** (SheetJS from its official CDN; the npm copy is outdated) | Instant, works offline, and the data doesn't leave the device until Generate. |
| **Bad rows are skipped and listed** (sheet, row, reason, fix); good rows import | One typo shouldn't block a 200-row load sheet. Same code means update, new code means add, so re-importing is safe. |
| Setup draft saved in **browser storage**, and once "Save online & share" is pressed, **autosaved to the server** | Nothing is lost on refresh, and the admin can continue on another device. |
| Pre-generation checks in **two places**: instant browser checks (missing or duplicate entries), then server `/check` (impossible setups, same code as the solver) | Fast feedback while typing, and one source of truth for feasibility rules. |
| Labs seat the **whole section** (no batches yet) | Simpler for today. Splitting labs into batches (A1/A2) is a stage 2 item. |
| **SQLAlchemy** with `DATABASE_URL`: SQLite locally, **Supabase Postgres** in production | Render's free disk is wiped on restart. Data is stored as JSON blobs, so the model can grow without migrations. |
| **No login: a secret admin link** (`/setup#college=CODE&key=KEY`) plus a public share link and code | Nothing to sign up for. The key sits in the URL fragment, so it never reaches server logs. Only its hash is stored. Every write needs it in `X-Admin-Key`. |
| **Publish** is a separate, explicit step, and the server re-runs the clash checker first | Students see only a timetable the admin chose, and never one with clashes. Each publish is a new version. |
| /my **caches the published timetable** in browser storage | It opens instantly and still works with no internet. |
| **Bookings use the published timetable's period grid** and event rooms. A date maps to the college's own day name. | Organisers think in "periods 3–4", like everyone else in the college. A day with no classes leaves every period free. |
| **The backend owns the booking clash rule**: a request needs free periods (no class, no approved or pending booking), and every approval checks again | Two approved bookings can never overlap, even if two people press Approve at the same time. |
| **Each approval step has its own secret link**, and it only works while the request waits at that step | It really is digital sign-off in order: the Dean can't sign before the HOD, and nobody needs an account. The admin link may act for any step. |
| Organisers get a **tracking link** (`/track/<token>`), with no login | Like a parcel: "Waiting for Dean since 2 hours". Their phone or email is shown only to approvers, never on the public events calendar. |
| Claude chatbot uses **tool use**, called **from the backend only** | Answers come from real data and real functions, never guesses. The API key is never exposed to the browser. |
| Chatbot model: **Haiku** (latest) | Fast and cheap enough for a live demo with many judges. Set a spending limit in the Anthropic console. |

## Product roadmap

### Today (2 hours): win the core
1. Data entry for an admin, with a **sample college preloaded** so the demo works in one click.
2. **Timetable generation** with CP-SAT: zero clashes, labs as blocks, soft rules scored.
3. ✅ Easy-to-read **section / teacher / room views** (day × period grid, breaks with clock times, colour by subject, labs as one block), a **My timetable** page with Today, print and phone layouts.
4. A clear message when generation fails (which resource is short).
5. If time allows: a **simple hall booking**. Pick a date, see **only free slots** (taken from the timetable and other bookings), submit, and approve with one click.
6. If the core is done by about minute 90: an **"Ask the timetable"** box (e.g. "Where's my next class?") using Claude tool use.

### Stage 2 (by Tuesday)
- **Students**: "My day" view (today + next class), live free-room status, changes feed ("DBMS moved to Room 204"), add to Google Calendar (.ics).
- **Teachers**: "My week" with free periods, leave + suggested substitutes (free that period and teaching that subject), extra or makeup class finder, preferences the solver respects ("no classes before 10 on Fridays").
- **Organisers**: full approval chain (organiser → HOD → dean, one click each, status visible at every step), a college events calendar to avoid same-day clashes.
- **Admins / HODs**: fair sharing of seminar halls and labs between departments, reports (teacher workload, room usage, rooms that could be freed), exam timetables (no student has two exams at once) using the same solver.
- **Offline / low-connectivity colleges**:
  - **Local college server**: one `docker compose up` runs the backend, frontend and database on a PC in the college LAN. It works with no internet and keeps the data on campus. Same images as the cloud deploy.
  - **Installable PWA for viewing**: teachers and students install the app on their phones. A service worker caches their published timetable, so it opens offline, and changes sync when back online. Viewing works offline; editing and generating need the server.
- **Chatbot (Claude, tool use)**:
  - Students and teachers: "What do I have tomorrow?", "When is Prof. Sharma free?", "Is any room free now?"
  - Organisers: "Book the seminar hall next Friday afternoon for 60 people". The bot finds a hall that fits and drafts the request, and the user confirms it.
  - Admins: **paste a messy load sheet** (Excel/WhatsApp) and get clean teacher/subject/hour entries back. The bot **explains why generation failed** in plain words and suggests fixes. **Edits on request** are proposed, clash-checked, then saved.
  - The bot never builds a timetable itself. OR-Tools does the scheduling, and Claude handles the language.

## Security
- `ANTHROPIC_API_KEY` lives only in `backend/.env` locally and in Render env settings in production. It never goes in the frontend or in a `NEXT_PUBLIC_` variable.
- `.env` files are git-ignored from the first commit, and the repo will be public. Only `*.example` files are committed.
- Set a spending limit in the Anthropic console before the demo.
