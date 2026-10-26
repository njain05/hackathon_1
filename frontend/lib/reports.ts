// Numbers about a generated timetable: teacher workload, room usage and
// section load. Pure functions: no React, nothing college-specific.

import { entriesFor } from "./grid";
import type { CollegeData, Entry, RoomUse } from "./types";

/** A department this far above its own average gets flagged (and at least MIN_GAP periods above it). */
export const HEAVY_RATIO = 1.5;
export const HEAVY_MIN_GAP = 4;
/** A department average only means something with a few teachers (same rule as the Check step). */
export const MIN_DEPT_TEACHERS = 3;
/** Rooms used for less than this share of the week could be freed. */
export const LOW_USE = 0.2;

/** Lab batches are being added by another part of the app; read the field without assuming it exists. */
export const batchOf = (e: Entry): string | null => (e as Entry & { batch?: string | null }).batch ?? null;

/** Names for codes, falling back to the code when something is missing. */
export function lookup(d: CollegeData) {
  const subjects = new Map(d.subjects.map((s) => [s.id, s]));
  const teachers = new Map(d.teachers.map((t) => [t.id, t]));
  const sections = new Map(d.sections.map((s) => [s.id, s]));
  const rooms = new Map(d.rooms.map((r) => [r.id, r]));
  const groups = new Map((d.elective_groups ?? []).map((g) => [g.id, g]));
  const departments = new Map(d.departments.map((x) => [x.id, x]));
  const roomTypes = new Map(d.room_types.map((t) => [t.id, t]));
  return {
    subject: (id: string) => subjects.get(id)?.name || id,
    teacher: (id: string) => teachers.get(id)?.name || id,
    /** An elective's section id is its group id: show the group's name. */
    section: (id: string) => sections.get(id)?.name || groups.get(id)?.name || id,
    room: (id: string) => rooms.get(id)?.name || id,
    group: (id: string) => groups.get(id)?.name || id,
    department: (id: string) => departments.get(id)?.name || id,
    roomType: (id: string) => roomTypes.get(id),
  };
}

/** "CSE-3A – CSE 3rd Sem A", or just the name when it already contains the code. */
export const codeAndName = (id: string, name: string) => (!name || name.includes(id) ? name || id : `${id} – ${name}`);

export interface DayCount {
  day: string;
  periods: number;
}

const slotKey = (e: Entry) => `${e.day}|${e.period}`;

/** Distinct (day, period) slots, so two entries in one slot (batches, combined classes) count once. */
function slotsByDay(days: string[], entries: Entry[]): DayCount[] {
  const seen = new Map<string, Set<number>>(days.map((d) => [d, new Set<number>()]));
  for (const e of entries) seen.get(e.day)?.add(e.period);
  return days.map((day) => ({ day, periods: seen.get(day)?.size ?? 0 }));
}

const total = (byDay: DayCount[]) => byDay.reduce((n, d) => n + d.periods, 0);

/** First day with the most (or fewest) periods, in the college's day order. */
function extreme(byDay: DayCount[], pick: "max" | "min"): DayCount | null {
  let best: DayCount | null = null;
  for (const d of byDay) if (!best || (pick === "max" ? d.periods > best.periods : d.periods < best.periods)) best = d;
  return best;
}

export const weekSlots = (d: CollegeData) => d.settings.days.length * d.settings.periods_per_day;

// ---------- Teachers ----------

export type LoadFlag =
  | { kind: "heavy"; ratio: number; average: number; department: string }
  | { kind: "over_limit"; limit: number };

export interface TeacherLoad {
  id: string;
  name: string;
  departmentId: string;
  periods: number;
  byDay: DayCount[];
  busiest: DayCount | null;
  lightest: DayCount | null;
  /** Average of the department's teachers who teach at all; null when there are none. */
  deptAverage: number | null;
  deptTeachers: number;
  maxPerWeek: number | null;
  flags: LoadFlag[];
}

export interface DepartmentLoad {
  id: string;
  name: string;
  teachers: number; // teachers with at least one class
  average: number;
}

export interface WorkloadReport {
  teachers: TeacherLoad[]; // most periods first
  departments: DepartmentLoad[];
  collegeAverage: number;
  teaching: number; // teachers with at least one class
}

export function teacherWorkload(d: CollegeData, entries: Entry[]): WorkloadReport {
  const days = d.settings.days;
  const byTeacher = new Map<string, Entry[]>();
  for (const e of entries) byTeacher.set(e.teacher_id, [...(byTeacher.get(e.teacher_id) ?? []), e]);

  // Everyone in the setup, plus any teacher code found only in the timetable.
  const people = [
    ...d.teachers.map((t) => ({ id: t.id, name: t.name || t.id, departmentId: t.department_id, max: t.max_periods_per_week ?? null })),
    ...[...byTeacher.keys()]
      .filter((id) => !d.teachers.some((t) => t.id === id))
      .map((id) => ({ id, name: id, departmentId: "", max: null })),
  ];
  const rows = people.map((p) => {
    const byDay = slotsByDay(days, byTeacher.get(p.id) ?? []);
    const periods = total(byDay);
    return { ...p, byDay, periods };
  });

  const teaching = rows.filter((r) => r.periods > 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const collegeAverage = mean(teaching.map((r) => r.periods));
  const deptIds = [...new Set(teaching.map((r) => r.departmentId))];
  const departments: DepartmentLoad[] = deptIds
    .map((id) => {
      const staff = teaching.filter((r) => r.departmentId === id);
      return {
        id,
        name: d.departments.find((x) => x.id === id)?.name || id || "No department",
        teachers: staff.length,
        average: mean(staff.map((r) => r.periods)),
      };
    })
    .sort((a, b) => d.departments.findIndex((x) => x.id === a.id) - d.departments.findIndex((x) => x.id === b.id));
  const dept = new Map(departments.map((x) => [x.id, x]));

  const teachers: TeacherLoad[] = rows.map((r) => {
    const dl = dept.get(r.departmentId);
    const flags: LoadFlag[] = [];
    if (
      dl &&
      r.periods > 0 &&
      dl.teachers >= MIN_DEPT_TEACHERS &&
      r.periods >= dl.average * HEAVY_RATIO &&
      r.periods - dl.average >= HEAVY_MIN_GAP
    )
      flags.push({ kind: "heavy", ratio: r.periods / dl.average, average: dl.average, department: r.departmentId });
    if (r.max !== null && r.max > 0 && r.periods > r.max) flags.push({ kind: "over_limit", limit: r.max });
    return {
      id: r.id,
      name: r.name,
      departmentId: r.departmentId,
      periods: r.periods,
      byDay: r.byDay,
      busiest: r.periods ? extreme(r.byDay, "max") : null,
      lightest: r.periods ? extreme(r.byDay, "min") : null,
      deptAverage: dl ? dl.average : null,
      deptTeachers: dl?.teachers ?? 0,
      maxPerWeek: r.max,
      flags,
    };
  });
  teachers.sort((a, b) => b.periods - a.periods || a.name.localeCompare(b.name));
  return { teachers, departments, collegeAverage, teaching: teaching.length };
}

// ---------- Rooms ----------

export interface RoomUsage {
  id: string;
  name: string;
  typeName: string;
  use: Exclude<RoomUse, "event">;
  used: number;
  slots: number;
  share: number; // 0..1
}

/** Rooms that hold classes (lecture or lab use). Seminar halls and auditoriums are left out. */
export function roomUsage(d: CollegeData, entries: Entry[]): RoomUsage[] {
  const n = lookup(d);
  const slots = weekSlots(d);
  const used = new Map<string, Set<string>>();
  const hasLab = new Set<string>();
  for (const e of entries) {
    used.set(e.room_id, (used.get(e.room_id) ?? new Set<string>()).add(slotKey(e)));
    if (e.kind === "lab") hasLab.add(e.room_id);
  }
  const out: RoomUsage[] = [];
  for (const r of d.rooms) {
    const type = n.roomType(r.type);
    if (type?.use === "event") continue;
    // A room with an unknown type counts only if classes were put in it.
    if (!type && !used.has(r.id)) continue;
    const u = used.get(r.id)?.size ?? 0;
    out.push({
      id: r.id,
      name: r.name || r.id,
      typeName: type?.name || r.type || "Room",
      use: type ? (type.use as "lecture" | "lab") : hasLab.has(r.id) ? "lab" : "lecture",
      used: u,
      slots,
      share: slots ? u / slots : 0,
    });
  }
  return out.sort((a, b) => b.share - a.share || a.id.localeCompare(b.id));
}

// ---------- Sections ----------

export interface SectionLoad {
  id: string;
  name: string;
  periods: number;
  slots: number;
  free: number;
  freeByDay: DayCount[];
  mostFree: DayCount | null;
}

export function sectionLoad(d: CollegeData, entries: Entry[]): SectionLoad[] {
  const days = d.settings.days;
  const perDay = d.settings.periods_per_day;
  const slots = weekSlots(d);
  return d.sections
    .map((s) => {
      const byDay = slotsByDay(days, entriesFor(entries, "section", s.id));
      const periods = total(byDay);
      const freeByDay = byDay.map((x) => ({ day: x.day, periods: Math.max(0, perDay - x.periods) }));
      const mostFree = extreme(freeByDay, "max");
      return {
        id: s.id,
        name: s.name || s.id,
        periods,
        slots,
        free: Math.max(0, slots - periods),
        freeByDay,
        mostFree: mostFree && mostFree.periods > 0 ? mostFree : null,
      };
    })
    .sort((a, b) => b.periods - a.periods || a.id.localeCompare(b.id));
}

/** "8.7" for averages, "9" when whole. */
export const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toString();
export const percent = (share: number) => `${Math.round(share * 100)}%`;
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
