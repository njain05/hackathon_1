"""Independent clash checker.

Re-checks any timetable (from the solver, an import or a manual edit) against
the hard rules. It deliberately shares no code with the solver, so a solver
bug can't hide itself here.
"""

from collections import Counter, defaultdict

from .models import CheckReport, CollegeData, Entry, Issue


def check_timetable(data: CollegeData, entries: list[Entry]) -> CheckReport:
    s = data.settings
    sections = {x.id: x for x in data.sections}
    subjects = {x.id: x for x in data.subjects}
    teachers = {x.id: x for x in data.teachers}
    rooms = {x.id: x for x in data.rooms}
    room_use = {t.id: t.use for t in data.room_types}
    unavailable = {(t.id, sl.day, sl.period) for t in data.teachers for sl in t.unavailable}
    assigned = {(a.section_id, a.subject_id): a for a in data.assignments}
    groups = {g.id: g for g in data.elective_groups}
    # elective group -> (subject, teacher) of an option -> the slots it met in
    group_slots: dict[str, dict[tuple[str, str], set[tuple[str, int]]]] = defaultdict(lambda: defaultdict(set))

    def may_use(room_id: str, department_id: str) -> bool:
        room = rooms[room_id]
        return room.department_id in (None, department_id) or department_id in room.shared_with

    clashes: list[Issue] = []
    violations: list[Issue] = []
    seen: set[tuple[str, ...]] = set()

    def violation(kind: str, key: tuple[str, ...], message: str, e: Entry | None = None) -> None:
        if (kind, *key) not in seen:
            seen.add((kind, *key))
            violations.append(Issue(
                kind=kind, message=message,
                day=e.day if e else None, period=e.period if e else None,
            ))

    by_teacher: dict[tuple[str, str, int], list[Entry]] = defaultdict(list)
    by_section: dict[tuple[str, str, int], list[Entry]] = defaultdict(list)
    by_room: dict[tuple[str, str, int], list[Entry]] = defaultdict(list)
    hours: Counter[tuple[str, str, str]] = Counter()
    lab_periods: dict[tuple[str, str, str], list[tuple[int, str]]] = defaultdict(list)

    for e in entries:
        if e.day not in s.days or not 1 <= e.period <= s.periods_per_day:
            violation("bad_slot", (e.day, str(e.period)), f"{e.day} period {e.period} is not a teaching period.", e)
            continue
        if e.kind == "elective":
            g = groups.get(e.elective_group or "")
            missing = [
                f'{label} "{i}"'
                for label, i, table in (
                    ("elective group", e.elective_group or "", groups), ("subject", e.subject_id, subjects),
                    ("teacher", e.teacher_id, teachers), ("room", e.room_id, rooms),
                )
                if i not in table
            ]
            if missing or g is None:
                violation("unknown_id", tuple(missing), f"Unknown {', '.join(missing)}.", e)
                continue
            sub, room = subjects[e.subject_id], rooms[e.room_id]
            option = next((o for o in g.options if o.subject_id == e.subject_id and o.teacher_id == e.teacher_id), None)
            if option is None:
                violation("not_assigned", (g.id, e.subject_id, e.teacher_id),
                          f"{sub.name} by {teachers[e.teacher_id].name} isn't an option of {g.name}.", e)
                continue
            by_teacher[e.teacher_id, e.day, e.period].append(e)
            by_room[e.room_id, e.day, e.period].append(e)
            # Each member section is busy once per meeting, however many options run in parallel.
            for sid in g.section_ids:
                here = by_section[sid, e.day, e.period]
                if not any(x.elective_group == g.id for x in here):
                    here.append(e)
            group_slots[g.id][e.subject_id, e.teacher_id].add((e.day, e.period))
            if room_use.get(room.type) != "lecture":
                violation("lecture_room", (room.id, sub.id), f"{sub.name} ({g.name}) is in {room.name}, which is not a classroom.", e)
            if room.capacity < option.students:
                violation("capacity", (room.id, g.id, sub.id),
                          f"{room.name} seats {room.capacity}, but {option.students} students chose {sub.name} ({g.name}).", e)
            if not may_use(room.id, sub.department_id):
                violation("room_department", (room.id, g.id, sub.id),
                          f"{room.name} belongs to another department and isn't shared with {sub.department_id}, "
                          f"but {sub.name} ({g.name}) uses it.", e)
            if (e.teacher_id, e.day, e.period) in unavailable:
                violation("teacher_unavailable", (e.teacher_id, e.day, str(e.period)),
                          f"{teachers[e.teacher_id].name} teaches on {e.day} period {e.period}, but is marked unavailable then.", e)
            continue
        missing = [
            f'{label} "{i}"'
            for label, i, table in (
                ("section", e.section_id, sections), ("subject", e.subject_id, subjects),
                ("teacher", e.teacher_id, teachers), ("room", e.room_id, rooms),
            )
            if i not in table
        ]
        if missing:
            violation("unknown_id", tuple(missing), f"Unknown {', '.join(missing)}.", e)
            continue

        sec, sub, room = sections[e.section_id], subjects[e.subject_id], rooms[e.room_id]
        by_teacher[e.teacher_id, e.day, e.period].append(e)
        by_section[e.section_id, e.day, e.period].append(e)
        by_room[e.room_id, e.day, e.period].append(e)
        hours[e.section_id, e.subject_id, e.kind] += 1

        if room.capacity < sec.strength:
            violation("capacity", (room.id, sec.id),
                      f"{room.name} seats {room.capacity}, but {sec.name} has {sec.strength} students.", e)
        if not may_use(room.id, sec.department_id):
            violation("room_department", (room.id, sec.id),
                      f"{room.name} is reserved for another department, but {sec.name} uses it.", e)
        if (e.teacher_id, e.day, e.period) in unavailable:
            violation("teacher_unavailable", (e.teacher_id, e.day, str(e.period)),
                      f"{teachers[e.teacher_id].name} teaches on {e.day} period {e.period}, but is marked unavailable then.", e)
        if e.kind == "lab":
            if room_use.get(room.type) != "lab":
                violation("lab_room", (room.id, sub.id), f"{sub.name} lab is in {room.name}, which is not a lab.", e)
            elif sub.lab_room_type is not None and room.type != sub.lab_room_type:
                violation("lab_room", (room.id, sub.id), f"{sub.name} lab is in {room.name}, which is the wrong kind of lab.", e)
            lab_periods[e.section_id, e.subject_id, e.day].append((e.period, e.room_id))
        elif room_use.get(room.type) != "lecture":
            violation("lecture_room", (room.id, sub.id), f"{sub.name} lecture is in {room.name}, which is not a classroom.", e)

        a = assigned.get((e.section_id, e.subject_id))
        if a is None:
            violation("not_assigned", (sec.id, sub.id), f"{sub.name} is not assigned to {sec.name}.", e)
        else:
            expected = (a.lab_teacher_id or a.teacher_id) if e.kind == "lab" else a.teacher_id
            if e.teacher_id != expected:
                violation("wrong_teacher", (sec.id, sub.id, e.kind),
                          f"{sub.name} ({e.kind}) for {sec.name} should be taught by "
                          f"{teachers[expected].name if expected in teachers else expected}.", e)

    # ---- Clashes: the same teacher, section or room twice in one period ----
    def label(e: Entry, attr: str) -> str:
        if e.kind == "elective":
            g = groups[e.elective_group or ""]
            return g.name if attr == "section" else f"{g.name}: {subjects[e.subject_id].name}"
        return sections[e.section_id].name if attr == "section" else subjects[e.subject_id].name

    def names(es: list[Entry], attr: str) -> str:
        return ", ".join(sorted(label(e, attr) for e in es))

    for (tid, day, p), es in by_teacher.items():
        if len(es) > 1:
            clashes.append(Issue(kind="teacher_clash", day=day, period=p,
                                 message=f"{teachers[tid].name} has {len(es)} classes on {day} period {p} ({names(es, 'section')})."))
    for (sid, day, p), es in by_section.items():
        if len(es) > 1:
            clashes.append(Issue(kind="section_clash", day=day, period=p,
                                 message=f"{sections[sid].name} has {len(es)} classes on {day} period {p} ({names(es, 'subject')})."))
    for (rid, day, p), es in by_room.items():
        if len(es) > 1:
            clashes.append(Issue(kind="room_clash", day=day, period=p,
                                 message=f"{rooms[rid].name} is booked {len(es)} times on {day} period {p} ({names(es, 'section')})."))

    # ---- Electives: every option meets its periods, all options at the same times ----
    for g in data.elective_groups:
        slot_sets = []
        for o in g.options:
            got = group_slots[g.id].get((o.subject_id, o.teacher_id), set())
            slot_sets.append(got)
            if len(got) != g.periods_per_week:
                name = subjects[o.subject_id].name if o.subject_id in subjects else o.subject_id
                violation("hours", (g.id, o.subject_id, o.teacher_id),
                          f"{name} ({g.name}) meets {len(got)} periods a week, needs {g.periods_per_week}.")
        if slot_sets and any(x != slot_sets[0] for x in slot_sets[1:]):
            violation("elective_split", (g.id,), f"The options of {g.name} don't all run at the same times.")

    # ---- Teachers' weekly cap ----
    week_load = Counter(tid for (tid, _, _) in by_teacher)
    for t in data.teachers:
        if t.max_periods_per_week is not None and week_load[t.id] > t.max_periods_per_week:
            violation("teacher_weekly_max", (t.id,),
                      f"{t.name} teaches {week_load[t.id]} periods a week, more than their limit of {t.max_periods_per_week}.")

    # ---- Every assignment gets exactly its hours ----
    for (sid, subid), a in assigned.items():
        if sid not in sections or subid not in subjects:
            continue
        sub = subjects[subid]
        for kind, need in (("lecture", sub.lecture_hours), ("lab", sub.lab_hours)):
            got = hours[sid, subid, kind]
            if got != need:
                violation("hours", (sid, subid, kind),
                          f"{sections[sid].name} has {got} {kind} periods of {sub.name}, needs {need}.")

    # ---- Labs are blocks of consecutive periods in one room, not crossing a break ----
    lab_cuts = {b.after_period for b in s.breaks if not b.labs_continue}
    for (sid, subid, day), slots in lab_periods.items():
        block = subjects[subid].lab_block_length
        slots.sort()
        runs: list[int] = []
        prev: tuple[int, str] | None = None
        for p, rid in slots:
            continues = prev is not None and p == prev[0] + 1 and rid == prev[1] and prev[0] not in lab_cuts
            if continues:
                runs[-1] += 1
            else:
                runs.append(1)
            prev = (p, rid)
        if any(r % block for r in runs):
            violation("lab_block", (sid, subid, day),
                      f"{subjects[subid].name} lab for {sections[sid].name} on {day} is not in "
                      f"blocks of {block} consecutive periods in one room.")

    return CheckReport(ok=not clashes and not violations, clashes=clashes, violations=violations)
