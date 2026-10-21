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
- **College settings**: working days (e.g. Mon–Sat), periods per day, period times, lunch break (which period index or indices are blocked).
- **Department**: id, name.
- **Section**: id, department, name (e.g. "CSE-3A"), student strength.
- **Subject**: id, name, code, department, `lecture_hours_per_week`, `lab_hours_per_week`, `lab_block_length` (consecutive periods per lab session, default 2).
- **Teacher**: id, name, department, optional max periods per day and per week, optional preferences (stage 2).
- **Assignment**: (teacher, subject, section). This says who teaches what to whom. A subject can have different teachers for lecture and lab.
- **Room**: id, name, type (`classroom` | `lab` | `seminar_hall` | `auditorium`), capacity, optional department.
- **Timetable (output)**: list of entries (day, period, section, subject, teacher, room, kind = lecture | lab), plus solver stats and a soft-rule score.
- **Booking (stage 1 lite)**: room, date, period range, organiser, purpose, attendees, status (`pending` → `approved` / `rejected`), with an approval chain in stage 2.

## Hard rules (must never break: these are constraints)
1. No **teacher** is double-booked in any (day, period).
2. No **section** is double-booked in any (day, period).
3. No **room** is double-booked in any (day, period).
4. **Labs** are held only in `lab` rooms, as **consecutive periods** (a block of `lab_block_length` periods) that do not cross the lunch break or the end of the day.
5. **Room capacity** ≥ section strength.
6. Exactly the required lecture and lab hours per week are scheduled for every assignment.
7. Nothing is scheduled in the lunch break.

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
| In-memory or JSON storage for the hackathon, a real DB in stage 2 | Saves time today. The data model is designed so a DB can be added later. |
| Claude chatbot uses **tool use**, called **from the backend only** | Answers come from real data and real functions, never guesses. The API key is never exposed to the browser. |
| Chatbot model: **Haiku** (latest) | Fast and cheap enough for a live demo with many judges. Set a spending limit in the Anthropic console. |

## Product roadmap

### Today (2 hours): win the core
1. Data entry for an admin, with a **sample college preloaded** so the demo works in one click.
2. **Timetable generation** with CP-SAT: zero clashes, labs as blocks, soft rules scored.
3. Easy-to-read **section / teacher / room views** (day × period grid, lunch visible, colour by subject).
4. A clear message when generation fails (which resource is short).
5. If time allows: a **simple hall booking**. Pick a date, see **only free slots** (taken from the timetable and other bookings), submit, and approve with one click.
6. If the core is done by about minute 90: an **"Ask the timetable"** box (e.g. "Where's my next class?") using Claude tool use.

### Stage 2 (by Tuesday)
- **Students**: "My day" view (today + next class), live free-room status, changes feed ("DBMS moved to Room 204"), add to Google Calendar (.ics).
- **Teachers**: "My week" with free periods, leave + suggested substitutes (free that period and teaching that subject), extra or makeup class finder, preferences the solver respects ("no classes before 10 on Fridays").
- **Organisers**: full approval chain (organiser → HOD → dean, one click each, status visible at every step), a college events calendar to avoid same-day clashes.
- **Admins / HODs**: fair sharing of seminar halls and labs between departments, reports (teacher workload, room usage, rooms that could be freed), exam timetables (no student has two exams at once) using the same solver.
- **Chatbot (Claude, tool use)**:
  - Students and teachers: "What do I have tomorrow?", "When is Prof. Sharma free?", "Is any room free now?"
  - Organisers: "Book the seminar hall next Friday afternoon for 60 people". The bot finds a hall that fits and drafts the request, and the user confirms it.
  - Admins: **paste a messy load sheet** (Excel/WhatsApp) and get clean teacher/subject/hour entries back. The bot **explains why generation failed** in plain words and suggests fixes. **Edits on request** are proposed, clash-checked, then saved.
  - The bot never builds a timetable itself. OR-Tools does the scheduling, and Claude handles the language.

## Security
- `ANTHROPIC_API_KEY` lives only in `backend/.env` locally and in Render env settings in production. It never goes in the frontend or in a `NEXT_PUBLIC_` variable.
- `.env` files are git-ignored from the first commit, and the repo will be public. Only `*.example` files are committed.
- Set a spending limit in the Anthropic console before the demo.
