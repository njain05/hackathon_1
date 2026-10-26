# Demo test cases

**Product in one line:** Admins generate a clash-free college timetable; teachers and students view their own schedules; event organisers book seminar halls and auditoriums with digital approval.

## How to run (2 minutes before the demo)

```bash
cd backend

# Scripted test cases: 22 numbered cases, offline, never touches saved colleges
.venv/bin/python demo_checks.py

# Automated pytest suite (44 tests: solver, checker, API, bookings)
.venv/bin/python -m pytest -q

# Start the backend (needed for Part B)
.venv/bin/uvicorn app.main:app --reload --port 8000

# Start the frontend (needed for Part B)
cd ../frontend && npm run dev
```

Last run of `demo_checks.py`: **22 passed · 0 failed · 0 skipped**.
Last run of `pytest`: **44 passed**.

---

## Part A: Scripted test cases (`demo_checks.py`)

| # | What it proves | Input → expected result | Judging criterion |
|---|---|---|---|
| TC01 | **Sample college solves with 0 clashes** | Sample data (5 sections, 22 subjects, 14 teachers) → 115 entries, 0 clashes by both solver and the independent checker; direct recount also confirms no double-bookings | Core functionality |
| TC02 | Every assignment gets its weekly hours | 28 assignments checked → 0 discrepancies; 87 lecture + 28 lab = 115 total | Core functionality |
| TC03 | Labs are 2-period blocks, right room, never across lunch | 14 lab blocks; all consecutive, none crossing lunch (after period 4); tea break bridged where `labs_continue=True`; every lab in a room whose type = `lab` | Core functionality |
| TC04 | Room capacity, dept rooms and event halls respected | Seminar Hall and Auditorium never used for classes; all 115 entries: room capacity ≥ section strength; dept rooms stay in their dept | Core functionality |
| TC05 | Quality score in plain words | Score = 32 (teacher load imbalance only); all four soft-rule penalty buckets named | Design |
| TC06 | Teacher unavailable times are a hard constraint | HK blocked all Monday + Friday period 1 → 0 entries in those slots; checker confirms 0 clashes | Core functionality |
| TC07 | 6-day week and a different day shape | Mon–Sat, 8 periods/day, 08:30 start → solves; Saturday gets 21 entries; 0 clashes | Relevance |
| TC08 | No computer labs → plain-English error | Remove all computer labs → infeasible; kind = `no_room` with message naming the missing lab type | Usability |
| TC09 | Section of 200 → plain-English error | Section strength 200 (largest room seats 120) → infeasible; message says "200 students" | Usability |
| TC10 | Teacher overload → plain-English error | All CSE assignments given to HK → infeasible; message names Dr. Harpreet Kaur | Usability |
| TC11 | Broken data caught before the solver | Unknown teacher `"nobody"` + lab hours not divisible by block length → status `invalid`; both problems reported | Usability |
| TC12 | Independent checker catches a planted clash | Duplicate entry added (same teacher, same slot) → checker returns ok=False with a `teacher_clash` | Core functionality |
| TC13 | Save → publish → read by code/slug, then version 2 | Create college → publish v1 → read by code, lowercase code and slug → publish v2; admin key never appears in public response | Core functionality |
| TC14 | Wrong / missing admin key refused | No key, wrong key, other college's key → all 403; DELETE endpoint returns 405 | Security |
| TC15 | Publish refuses clashing and unsolved timetables | Duplicate entry → 400 "wasn't published"; infeasible result → 400; `published_version` stays null | Core functionality |
| TC16 | Database error → 503, no password leaked | `DATABASE_URL` pointed at a closed port → all `/colleges/*` return 503 with human-readable detail; password `TopSecret9` never appears; `/health` still responds ok | Security / Usability |
| TC17 | No secrets in tracked files | 90 tracked files scanned; `.env` is not tracked; no `sk-ant-*` strings found | Submission rules |
| TC18 | Availability: only free periods offered | Book periods 3–4 → availability shows them as `requested`; other periods remain free | Core booking |
| TC19 | Overlapping booking refused | Periods 3–4 taken; try 4–5 → 409 "Period 4 … is requested"; adjacent (5–6), next day, other hall: all 201 | Core booking |
| TC20 | Capacity check; non-event rooms refused | 151 attendees in Seminar Hall (seats 150) → 400; Auditorium at 600 → 201; Classroom C-101 → 400 | Core booking |
| TC21 | HOD → Dean chain runs in order | Dean's link before HOD → 409 "waiting for HOD"; HOD approves → waiting\_for = Dean; Dean approves → status = approved; appears on /events without contact info | Core booking / Advanced |
| TC22 | Reject / cancel frees the slot | Admin rejects → slot free; organiser cancels next via tracking link → slot free again; /events shows 0 entries | Core booking |

---

## Part B: Live in the browser (about 5 minutes)

### Setup wizard → generate → views

1. Open **http://localhost:3000**. The home badge should show "Server connected".
2. Click **Load sample college** (or start from the Engineering template and fill in a few rows).
3. Work through the 6 wizard steps (College & week → Rooms → Teachers → Sections → Subjects → Check & generate).
4. On the **Check** step, verify the instant browser checks run (try deleting a teacher to see a red error, then undo).
5. Click **Generate**. Watch the loading message. After ~5 s the solver returns "Verified: 0 clashes".

### Timetable views

6. On `/timetable`, switch between **By section**, **By teacher** and **By room** using the dropdowns.
7. Point out: the colour-by-subject grid, lab cells spanning two columns, the lunch-break column with clock times, and the quality score panel ("32 soft-rule penalty points").
8. Click **Print this timetable** (opens a print-ready A4 page).

### My timetable (`/my`) with a faked clock

9. Navigate to `/my?now=Monday+10:15`. Pick "I'm a student" → CSE-3A.
10. The **Today** card shows the current period as "Now" with minutes remaining.
11. Open the URL `/my?now=Monday+12:00` — the Today card should read "Lunch until 12:30".
12. Open `/my?now=Sunday+09:00` — should say "No classes today. First class Monday."
13. Switch to "I'm a teacher" → Dr. Harpreet Kaur.

### Share link and offline copy

14. Back on `/timetable`, click **Save online & share** → a 6-letter code and admin link appear.
15. Click **Publish timetable** → "Live for everyone, version 1".
16. Open the share link `/c/<code>` in a private / incognito window. `/my` loads the published timetable from the server and caches it.
17. With the browser offline (DevTools → Network → Offline), reload `/my`. It shows "Showing the copy saved on this phone".

### Hall booking

18. Open **/book** (or /book?college=CODE). Pick a date, then click period 3 and period 4 on Seminar Hall to select them. Fill in the form and submit.
19. The tracking link opens. It shows "Waiting for Admin" (or the first approval step if a chain was set).
20. Open **/approvals** using the admin link. Approve with a note.
21. Go back to **/book** — periods 3 and 4 now show as **Booked**.
22. Visit **/events** — the approved booking appears with clock times.

---

## Part C: On a phone (375 px width)

1. Open `/my` on a phone (or resize to 375 px in DevTools). The day-by-day list should replace the grid, with no horizontal scroll.
2. Open the share link — it should load and look tidy on a small screen.
3. Check **/book** — hall cards, the period picker and the form should all fit without horizontal scroll.

---

## Honest limits (say these before they ask)

- **Lab batches not yet implemented.** Labs seat the whole section. Splitting a section into batch A / batch B is a planned Stage 2 feature (the data model already has a `batches` field planned in `context.md`).
- **No login.** Access is by secret link (admin) or public link (students/teachers). Session hijacking via URL sharing is a known trade-off; the key lives only in the URL fragment, so it never reaches server logs.
- **Solver time limit.** On Render's free CPU (≈ 0.1 core), generation takes up to 20 s and may not reach the optimal score. `SOLVER_WORKERS=2` is set in `render.yaml` for the best result at that CPU level. Locally it solves optimally in ≈ 5 s.
- **Hall booking needs a published timetable.** The room availability check reads the published timetable. A college that has never published can't book halls yet.
- **No Claude chatbot in this demo.** The AI "Ask the timetable" box is a Stage 2 item. The backend wires are in place (`ANTHROPIC_API_KEY`, tool-use pattern in context.md).

## Known issues found while preparing this

1. **Solver score on the live Render server is higher (~130 vs 32 locally)** because the free plan has very little CPU. It still produces a clash-free timetable. `SOLVER_WORKERS=2` (set in `render.yaml`) is already the best trade-off found for that CPU level. For the demo, run the solver locally where it reaches optimal.

2. **Print preview not tested programmatically.** The browser print dialog can't be triggered from automated tools. The print markup and `@media print` page breaks were verified visually. Do a real print preview (Ctrl+P) before the demo.

3. **The `labs_continue` tea-break bridging is correct in the solver and checker, but the grid UI shows it as a merged cell only if the two lab periods happen to be separated by the tea break.** If the solver places both lab periods before the break, the merge still looks like a normal 2-period block. No data is wrong; the display is accurate either way.
