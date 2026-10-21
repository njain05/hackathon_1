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
    assigned = {(a.section_id, a.subject_id): a for a in data.assignments}

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
        if room.department_id is not None and room.department_id != sec.department_id:
            violation("room_department", (room.id, sec.id),
                      f"{room.name} is reserved for another department, but {sec.name} uses it.", e)
        if e.kind == "lab":
            if room.type != "lab":
                violation("lab_room", (room.id, sub.id), f"{sub.name} lab is in {room.name}, which is not a lab.", e)
            elif sub.lab_room_ids is not None and room.id not in sub.lab_room_ids:
                violation("lab_room", (room.id, sub.id), f"{sub.name} lab is in {room.name}, which is not allowed for it.", e)
            lab_periods[e.section_id, e.subject_id, e.day].append((e.period, e.room_id))
        elif room.type != "classroom":
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
    def names(es: list[Entry], attr: str) -> str:
        return ", ".join(sorted(sections[e.section_id].name if attr == "section" else subjects[e.subject_id].name for e in es))

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

    # ---- Labs are blocks of consecutive periods in one room, not crossing lunch ----
    lunch = s.lunch_after_period
    for (sid, subid, day), slots in lab_periods.items():
        block = subjects[subid].lab_block_length
        slots.sort()
        runs: list[int] = []
        prev: tuple[int, str] | None = None
        for p, rid in slots:
            continues = prev is not None and p == prev[0] + 1 and rid == prev[1] and prev[0] != lunch
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
