"""Checks that run before the solver.

`validate_data` finds broken input (unknown ids, impossible lab blocks).
`find_shortages` finds resources that are clearly too small, and explains
which one is short in plain words, so the admin knows what to fix.
Each problem names the setup `step` where it can be fixed.
"""

from collections import Counter, defaultdict

from .common import Index, batches_for, elective_rooms, lab_rooms, lab_segments, lab_teacher, lecture_rooms
from .models import CollegeData, Problem, Room


def _dupes(ids: list[str]) -> list[str]:
    return sorted(i for i, n in Counter(ids).items() if n > 1)


def validate_data(data: CollegeData) -> list[Problem]:
    idx = Index(data)
    s = data.settings
    problems: list[Problem] = []

    def bad(step: str, msg: str, fix: str = "") -> None:
        if not fix and "unknown" in msg:
            fix = "Check the code is spelled correctly, or add the missing item."
        problems.append(Problem(kind="invalid_data", message=msg, suggestion=fix, step=step))

    for step, label, items in [
        ("week", "department", data.departments),
        ("rooms", "room type", data.room_types),
        ("rooms", "room", data.rooms),
        ("teachers", "teacher", data.teachers),
        ("sections", "section", data.sections),
        ("subjects", "subject", data.subjects),
    ]:
        for d in _dupes([x.id for x in items]):
            bad(step, f'Two {label}s share the code "{d}".', "Give every item a different code.")

    for sec in data.sections:
        if sec.department_id not in idx.departments:
            bad("sections", f'Section {sec.name} belongs to unknown department "{sec.department_id}".')
        for d in _dupes([b.id for b in sec.batches]):
            bad("sections", f'{sec.name} has two batches called "{d}".', "Give each batch a different name, e.g. A1 and A2.")

    longest_lab_run = max(len(seg) for seg in lab_segments(s))
    for sub in data.subjects:
        if sub.department_id not in idx.departments:
            bad("subjects", f'Subject {sub.name} belongs to unknown department "{sub.department_id}".')
        if sub.lab_room_type is not None:
            rt = idx.room_types.get(sub.lab_room_type)
            if rt is None:
                bad("subjects", f'Subject {sub.name} needs unknown lab room type "{sub.lab_room_type}".')
            elif rt.use != "lab":
                bad("subjects", f"Subject {sub.name} has its labs in {rt.name} rooms, which aren't used for labs.",
                    "Pick a room type used for labs, or change that room type's use.")
        if sub.lab_hours % sub.lab_block_length:
            bad("subjects",
                f"{sub.name} has {sub.lab_hours} lab periods, which can't be split into "
                f"blocks of {sub.lab_block_length}.",
                "Make lab periods a multiple of the lab block length.")
        if sub.lab_hours and sub.lab_block_length > longest_lab_run:
            bad("subjects",
                f"{sub.name} needs {sub.lab_block_length} periods in a row for a lab, but the "
                f"longest stretch without a break is {longest_lab_run} periods.",
                "Shorten the lab block, move a break, or allow labs to run across a short break.")

    for t in data.teachers:
        if t.department_id not in idx.departments:
            bad("teachers", f'Teacher {t.name} belongs to unknown department "{t.department_id}".')
        for slot in t.unavailable:
            if slot.day not in idx.day_pos or slot.period > s.periods_per_day:
                bad("teachers", f"{t.name} is marked unavailable on {slot.day} period {slot.period}, "
                    "which is not a teaching period.", "Fix or remove that unavailable time.")
    for r in data.rooms:
        if r.department_id is not None and r.department_id not in idx.departments:
            bad("rooms", f'Room {r.name} belongs to unknown department "{r.department_id}".')
        if r.type not in idx.room_types:
            bad("rooms", f'Room {r.name} has unknown room type "{r.type}".')
        for d in r.shared_with:
            if d not in idx.departments:
                bad("rooms", f'Room {r.name} is shared with unknown department "{d}".')

    pairs: set[tuple[str, str]] = set()
    for a in data.assignments:
        where = f"{a.subject_id} for {a.section_id}"
        if a.section_id not in idx.sections:
            bad("subjects", f'The class "{where}" uses unknown section "{a.section_id}".')
        if a.subject_id not in idx.subjects:
            bad("subjects", f'The class "{where}" uses unknown subject "{a.subject_id}".')
        for tid in {a.teacher_id, lab_teacher(a)}:
            if tid not in idx.teachers:
                bad("subjects", f'The class "{where}" uses unknown teacher "{tid}".')
        sec = idx.sections.get(a.section_id)
        if a.lab_by_batch and sec is not None and not sec.batches:
            bad("subjects", f'"{where}" has labs in batches, but {sec.name} has no batches.',
                "Add batches in Sections (Advanced options), or turn off labs in batches for this class.")
        if (a.section_id, a.subject_id) in pairs:
            bad("subjects", f'The class "{where}" is listed twice.',
                "Keep one row per subject per section.")
        pairs.add((a.section_id, a.subject_id))

    for d in _dupes([g.id for g in data.elective_groups]):
        bad("subjects", f'Two elective groups share the code "{d}".', "Give every elective group a different code.")
    for g in data.elective_groups:
        if g.id in idx.sections:
            bad("subjects", f'Elective group "{g.id}" has the same code as a section.', "Use a different code, e.g. OE-1.")
        for sid in g.section_ids:
            if sid not in idx.sections:
                bad("subjects", f'Elective group {g.name} lists unknown section "{sid}".')
        seen_teachers: set[str] = set()
        for o in g.options:
            if o.subject_id not in idx.subjects:
                bad("subjects", f'Elective group {g.name} offers unknown subject "{o.subject_id}".')
            if o.teacher_id not in idx.teachers:
                bad("subjects", f'Elective group {g.name} uses unknown teacher "{o.teacher_id}".')
            elif o.teacher_id in seen_teachers:
                bad("subjects",
                    f"{idx.teachers[o.teacher_id].name} teaches two options of {g.name}, which run at the same time.",
                    "Give each option of an elective group a different teacher.")
            seen_teachers.add(o.teacher_id)
    return problems


def _names(rooms: list[Room]) -> str:
    return ", ".join(r.name for r in rooms)


def teacher_capacity(data: CollegeData, teacher_id: str) -> int:
    """Periods a week this teacher can teach, after unavailability and daily limits."""
    t = Index(data).teachers[teacher_id]
    s = data.settings
    blocked: dict[str, set[int]] = defaultdict(set)
    for slot in t.unavailable:
        blocked[slot.day].add(slot.period)
    total = 0
    for day in s.days:
        n = s.periods_on(day)
        free = n - len({p for p in blocked[day] if 1 <= p <= n})
        total += min(free, t.max_periods_per_day) if t.max_periods_per_day else free
    if t.max_periods_per_week is not None:
        total = min(total, t.max_periods_per_week)
    return total


def find_shortages(data: CollegeData) -> list[Problem]:
    """Necessary conditions. If any fails, no timetable can exist. Assumes valid data."""
    idx = Index(data)
    s = data.settings
    slots = sum(s.periods_on(day) for day in s.days)
    problems: list[Problem] = []

    section_need: dict[str, int] = defaultdict(int)
    teacher_need: dict[str, int] = defaultdict(int)
    # demand grouped by the exact set of rooms it may use
    lecture_demand: dict[frozenset[str], int] = defaultdict(int)
    lab_demand: dict[frozenset[str], int] = defaultdict(int)

    for a in data.assignments:
        sec, sub = idx.sections[a.section_id], idx.subjects[a.subject_id]
        groups = batches_for(a, sec)
        # Batches can do their labs at the same time, so the section needs the lab hours once,
        # but the lab teacher and the labs need them once per batch.
        section_need[sec.id] += sub.lecture_hours + sub.lab_hours
        teacher_need[a.teacher_id] += sub.lecture_hours
        teacher_need[lab_teacher(a)] += sub.lab_hours * len(groups)

        if sub.lecture_hours:
            rooms = lecture_rooms(data, sec)
            if not rooms:
                problems.append(Problem(
                    kind="no_room", step="rooms",
                    message=f"No classroom can hold {sec.name} ({sec.strength} students) "
                    f"for {sub.name}.",
                    suggestion="Add a bigger classroom for this department, or a shared one.",
                ))
            lecture_demand[frozenset(r.id for r in rooms)] += sub.lecture_hours
        if sub.lab_hours:
            for batch, strength in groups:
                rooms = lab_rooms(data, sec, sub, strength)
                if not rooms:
                    kind = idx.room_types[sub.lab_room_type].name.lower() if sub.lab_room_type else "lab"
                    who = f"batch {batch} of {sec.name}" if batch else sec.name
                    problems.append(Problem(
                        kind="no_room", step="rooms",
                        message=f"No {kind} room fits {sub.name} labs for {who} ({strength} students).",
                        suggestion="Add a suitable lab, raise a lab's capacity, split the section into "
                        "lab batches (Sections → Advanced options), or change the subject's lab room type.",
                    ))
                lab_demand[frozenset(r.id for r in rooms)] += sub.lab_hours

    for g in data.elective_groups:
        for sid in g.section_ids:
            section_need[sid] += g.periods_per_week
        for o in g.options:
            teacher_need[o.teacher_id] += g.periods_per_week
            rooms = elective_rooms(data, o)
            sub = idx.subjects[o.subject_id]
            if not rooms:
                problems.append(Problem(
                    kind="no_room", step="rooms",
                    message=f"No classroom can hold the {o.students} students of {sub.name} ({g.name}) that "
                    f"{sub.department_id} may use.",
                    suggestion=f"Ask another department's HOD to share a big enough room with {sub.department_id}, "
                    "or add a shared classroom.",
                ))
            lecture_demand[frozenset(r.id for r in rooms)] += g.periods_per_week

    for sid, need in section_need.items():
        if need > slots:
            problems.append(Problem(
                kind="section_overload", step="subjects",
                message=f"{idx.sections[sid].name} needs {need} periods a week, but the week "
                f"has only {slots} teaching periods.",
                suggestion="Reduce its subject hours, or add periods or a working day.",
            ))

    for tid, need in teacher_need.items():
        t = idx.teachers[tid]
        cap = teacher_capacity(data, tid)
        if need > cap:
            why = (f"the week has only {slots} teaching periods" if cap == slots
                   else f"after their unavailable times and limits they can teach only {cap}")
            problems.append(Problem(
                kind="teacher_overload", step="subjects",
                message=f"{t.name} is assigned {need} periods a week, but {why}.",
                suggestion="Give some of their classes to another teacher.",
            ))

    # Hall's condition: demand that can only use rooms in set E must fit in E.
    for label, demand in (("classroom", lecture_demand), ("lab", lab_demand)):
        for room_set in {e for e in demand if e}:
            need = sum(d for e, d in demand.items() if e and e <= room_set)
            have = len(room_set) * slots
            if need > have:
                rooms = [idx.rooms[r] for r in sorted(room_set)]
                problems.append(Problem(
                    kind=f"{label}_shortage", step="rooms",
                    message=f"Not enough {label} time: classes that can only use "
                    f"{_names(rooms)} need {need} periods a week, but these rooms have "
                    f"only {have}.",
                    suggestion=f"Add another {label}, let more sections share rooms, or add "
                    "a working day.",
                ))
    return problems
