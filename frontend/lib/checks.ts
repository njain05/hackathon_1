// Instant checks in the browser for missing or inconsistent entries.
// Deeper "is this even possible?" checks run on the server (/check).

import { periodsOn } from "./periods";
import type { CollegeData, StepId } from "./types";

export interface Finding {
  level: "error" | "warning";
  message: string;
  suggestion: string;
  step: StepId;
}

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids.map((i) => i.trim().toLowerCase())) {
    if (seen.has(id)) out.add(id);
    seen.add(id);
  }
  return [...out];
}

export function localChecks(d: CollegeData): Finding[] {
  const f: Finding[] = [];
  const err = (step: StepId, message: string, suggestion = "") =>
    f.push({ level: "error", message, suggestion, step });
  const warn = (step: StepId, message: string, suggestion = "") =>
    f.push({ level: "warning", message, suggestion, step });

  const uses = new Map(d.room_types.map((t) => [t.id, t.use]));
  const depts = new Set(d.departments.map((x) => x.id));

  if (!d.settings.days.length) err("week", "No working days are selected.", "Pick at least one day.");
  if (!d.departments.length) err("week", "No departments yet.", "Add at least one department.");
  if (!d.rooms.some((r) => uses.get(r.type) === "lecture"))
    err("rooms", "No classrooms yet.", "Add the rooms where lectures happen.");
  if (!d.teachers.length) err("teachers", "No teachers yet.", "Add the teachers.");
  if (!d.sections.length) err("sections", "No sections yet.", "Add the sections (classes of students).");
  if (!d.subjects.length) err("subjects", "No subjects yet.", "Add the subjects.");
  if (!d.assignments.length)
    err("subjects", "Nobody is assigned to teach anything yet.", "Fill in “Who teaches what”.");

  const tables: [StepId, string, { id: string; name?: string }[]][] = [
    ["week", "department", d.departments],
    ["rooms", "room", d.rooms],
    ["teachers", "teacher", d.teachers],
    ["sections", "section", d.sections],
    ["subjects", "subject", d.subjects],
  ];
  for (const [step, noun, rows] of tables) {
    const blank = rows.filter((r) => !r.id.trim()).length;
    if (blank) err(step, `${blank} ${noun}${blank > 1 ? "s have" : " has"} no code.`, "Give every row a short code, or delete empty rows.");
    for (const id of dupes(rows.map((r) => r.id).filter((x) => x.trim())))
      err(step, `Two ${noun}s use the code “${id.toUpperCase()}”.`, "Codes must be different.");
  }

  for (const r of d.rooms) {
    if (r.capacity < 1) err("rooms", `Room ${r.id || "(no code)"} has no seats entered.`, "Enter how many students it holds.");
    if (r.department_id && !depts.has(r.department_id))
      err("rooms", `Room ${r.id} belongs to a department that no longer exists.`, "Pick its department again.");
  }
  for (const t of d.teachers) {
    if (!t.name.trim()) err("teachers", `Teacher ${t.id || "(no code)"} has no name.`);
    if (!depts.has(t.department_id)) err("teachers", `Teacher ${t.id} has no department.`, "Pick a department.");
  }
  for (const s of d.sections) {
    if (s.strength < 1) err("sections", `Section ${s.id || "(no code)"} has no student count.`);
    if (!depts.has(s.department_id)) err("sections", `Section ${s.id} has no department.`, "Pick a department.");
  }
  // Subjects offered as open-elective choices get their periods from the elective group.
  const electiveSubjects = new Set((d.elective_groups ?? []).flatMap((g) => g.options.map((o) => o.subject_id)));
  for (const s of d.subjects) {
    if (!s.name.trim()) err("subjects", `Subject ${s.id || "(no code)"} has no name.`);
    if (!depts.has(s.department_id)) err("subjects", `Subject ${s.id} has no department.`, "Pick a department.");
    if (s.lecture_hours + s.lab_hours === 0 && !electiveSubjects.has(s.id))
      warn("subjects", `${s.name || s.id} has no lectures or lab periods, so it won't appear in the timetable.`);
    if (s.lab_hours && s.lab_hours % s.lab_block_length)
      err("subjects", `${s.name || s.id} has ${s.lab_hours} lab periods, which don't split into blocks of ${s.lab_block_length}.`,
        "Make lab periods a multiple of the lab block (usually 2, 4 or 6).");
    if (s.lab_hours && !d.rooms.some((r) => uses.get(r.type) === "lab" && (!s.lab_room_type || r.type === s.lab_room_type)))
      err("rooms", `${s.name || s.id} has labs, but there's no ${s.lab_room_type ? d.room_types.find((t) => t.id === s.lab_room_type)?.name.toLowerCase() : "lab"} room.`,
        "Add a lab room of the right type.");
  }

  for (const a of d.assignments) {
    const sec = d.sections.find((x) => x.id === a.section_id);
    if (a.lab_by_batch && sec && !sec.batches?.length)
      err("subjects", `${a.subject_id} for ${sec.id} has labs in batches, but ${sec.id} has no batches.`,
        "Add batches in Sections (Advanced options), or set “Labs in batches” to No.");
  }

  const sections = new Set(d.sections.map((x) => x.id));
  const subjects = new Set(d.subjects.map((x) => x.id));
  const teachers = new Set(d.teachers.map((x) => x.id));
  d.assignments.forEach((a, i) => {
    const where = `Row ${i + 1} of “Who teaches what”`;
    if (!sections.has(a.section_id)) err("subjects", `${where} has no section.`);
    if (!subjects.has(a.subject_id)) err("subjects", `${where} has no subject.`);
    if (!teachers.has(a.teacher_id)) err("subjects", `${where} has no teacher.`);
  });
  for (const id of dupes(d.assignments.map((a) => `${a.section_id} ${a.subject_id}`)))
    err("subjects", `${id.toUpperCase()} is listed twice in “Who teaches what”.`, "Keep one row per subject per section.");

  const taughtSections = new Set(d.assignments.map((a) => a.section_id));
  for (const s of d.sections)
    if (!taughtSections.has(s.id)) warn("subjects", `Section ${s.id} has no subjects assigned yet.`);
  const busy = new Set([
    ...d.assignments.flatMap((a) => [a.teacher_id, a.lab_teacher_id ?? a.teacher_id]),
    ...(d.elective_groups ?? []).flatMap((g) => g.options.map((o) => o.teacher_id)),
  ]);
  for (const t of d.teachers)
    if (!busy.has(t.id)) warn("subjects", `${t.name || t.id} isn't teaching any class yet.`);

  // Fair workload: someone far above their department's average.
  const load = loads(d);
  const need = new Map(load.teachers.map((t) => [t.id, t.need]));
  for (const dept of d.departments) {
    const staff = d.teachers.filter((t) => t.department_id === dept.id && (need.get(t.id) ?? 0) > 0);
    if (staff.length < 3) continue;
    const avg = staff.reduce((n, t) => n + (need.get(t.id) ?? 0), 0) / staff.length;
    for (const t of staff) {
      const n = need.get(t.id) ?? 0;
      if (n >= avg * 1.5 && n - avg >= 4)
        warn("subjects", `${t.name || t.id} teaches ${n} periods a week, while ${dept.id}'s average is ${Math.round(avg)}.`,
          "Consider giving one of their classes to a colleague, or set “Max periods a week” for them (Teachers → Advanced options).");
    }
  }

  return f;
}

/** Weekly load per teacher and section, for the overview bars. */
export function loads(d: CollegeData) {
  const s = d.settings;
  const weekSlots = s.days.reduce((n, day) => n + periodsOn(s, day), 0);
  const subj = new Map(d.subjects.map((x) => [x.id, x]));
  const tNeed = new Map<string, number>();
  const sNeed = new Map<string, number>();
  for (const a of d.assignments) {
    const sub = subj.get(a.subject_id);
    if (!sub) continue;
    tNeed.set(a.teacher_id, (tNeed.get(a.teacher_id) ?? 0) + sub.lecture_hours);
    const lt = a.lab_teacher_id ?? a.teacher_id;
    // Lab batches do their labs separately: the lab teacher teaches each batch.
    const sec = d.sections.find((x) => x.id === a.section_id);
    const groups = a.lab_by_batch && sec?.batches?.length ? sec.batches.length : 1;
    tNeed.set(lt, (tNeed.get(lt) ?? 0) + sub.lab_hours * groups);
    sNeed.set(a.section_id, (sNeed.get(a.section_id) ?? 0) + sub.lecture_hours + sub.lab_hours);
  }
  for (const g of d.elective_groups ?? []) {
    for (const sid of g.section_ids) sNeed.set(sid, (sNeed.get(sid) ?? 0) + g.periods_per_week);
    for (const o of g.options) tNeed.set(o.teacher_id, (tNeed.get(o.teacher_id) ?? 0) + g.periods_per_week);
  }
  const teacherCap = (id: string) => {
    const t = d.teachers.find((x) => x.id === id);
    if (!t) return weekSlots;
    let total = 0;
    for (const day of s.days) {
      const blocked = new Set(t.unavailable.filter((u) => u.day === day).map((u) => u.period)).size;
      const free = periodsOn(s, day) - blocked;
      total += t.max_periods_per_day ? Math.min(free, t.max_periods_per_day) : free;
    }
    return t.max_periods_per_week ? Math.min(total, t.max_periods_per_week) : total;
  };
  return {
    weekSlots,
    teachers: d.teachers
      .map((t) => ({ id: t.id, name: t.name, need: tNeed.get(t.id) ?? 0, cap: teacherCap(t.id) }))
      .sort((a, b) => b.need / b.cap - a.need / a.cap),
    sections: d.sections
      .map((x) => ({ id: x.id, name: x.name || x.id, need: sNeed.get(x.id) ?? 0, cap: weekSlots }))
      .sort((a, b) => b.need - a.need),
  };
}
