// Teacher leave, substitutes, cancelled and extra classes (backend/app/changes.py).
// A day's actual timetable = the published week for that weekday + that date's changes.

import { call } from "./api";
import { periodText } from "./bookings";
import type { AdminAccess } from "./cloud";
import { type MemberAccess, asMember } from "./members";
import type { CollegeData, Entry, SolveResult } from "./types";

export type CheckReport = NonNullable<SolveResult["check"]>;

export interface Change {
  id: number;
  date: string;
  kind: "substitute" | "cancel" | "extra";
  section_id: string;
  subject_id: string;
  start_period: number;
  end_period: number;
  teacher_id: string;
  new_teacher_id: string | null;
  room_id: string;
  class_kind: "lecture" | "lab";
  note: string;
  leave_id: number | null;
}

export interface DayView {
  date: string;
  day: string;
  working_day: boolean;
  entries: Entry[];
  changes: Change[];
  check: CheckReport;
}

export interface Leave {
  id: number;
  teacher_id: string;
  date: string;
  start_period: number;
  end_period: number;
  reason: string;
  by: "admin" | "teacher";
  status: "pending" | "approved" | "rejected";
  /** While pending: "HOD (CSE)", or "the admin" if the department has no HOD link. */
  waiting_for: string | null;
  waiting_since: string | null;
  decided_by: string;
  decision_note: string;
  decided_at: string | null;
  created_at: string;
}

export interface HodView {
  department_id: string;
  department_name: string;
  name: string;
  college_name: string;
  leaves: Leave[];
}

export interface Suggestion {
  teacher_id: string;
  tier: "subject" | "department" | "anyone";
  load_today: number;
  /** Classes they covered in the 7 days up to this date (the ranking prefers fewer). */
  covers_week: number;
}

export interface AffectedClass {
  section_id: string;
  subject_id: string;
  start_period: number;
  end_period: number;
  room_id: string;
  class_kind: "lecture" | "lab";
  /** A lab batch (e.g. "A1") when the section's labs run per batch. */
  batch?: string | null;
  /** The whole lab block (with per-period cover, each hour is its own row): cancelling takes all of it. */
  block_start: number;
  block_end: number;
  state: "awaiting_approval" | "needs_cover" | "substitute" | "cancelled";
  change_id: number | null;
  new_teacher_id: string | null;
  suggestions: Suggestion[];
}

export interface CoverView {
  date: string;
  day: string;
  working_day: boolean;
  leaves: (Leave & { classes: AffectedClass[] })[];
  changes: Change[];
  check: CheckReport;
}

export interface SlotOption {
  period: number;
  ok: boolean;
  reason: string | null;
  rooms: string[];
}

export interface NewChange {
  date: string;
  kind: Change["kind"];
  section_id: string;
  start_period: number;
  end_period?: number;
  new_teacher_id?: string;
  subject_id?: string;
  teacher_id?: string;
  room_id?: string;
  note?: string;
  leave_id?: number | null;
}

const enc = encodeURIComponent;
const asAdmin = (a: AdminAccess) => ({ "X-Admin-Key": a.key });

/** Who arranges cover: the Dean (every department) or an HOD (their own department's classes).
 * The Dean's AdminAccess on its own is accepted too. */
export type StaffAuth = { admin: AdminAccess } | { member: MemberAccess } | AdminAccess;
const asStaff = (a: StaffAuth): { admin: AdminAccess } | { member: MemberAccess } => ("admin" in a || "member" in a ? a : { admin: a });
const staffHeaders = (a: StaffAuth) => {
  const s = asStaff(a);
  return "admin" in s ? asAdmin(s.admin) : asMember(s.member);
};
const staffCode = (a: StaffAuth) => {
  const s = asStaff(a);
  return "admin" in s ? s.admin.code : s.member.college_code;
};

/** College rules for daily changes, set by the Dean. */
export interface Rules {
  lab_cover: "per_period" | "whole";
}

// ---------- API ----------

export const getDay = (code: string, date: string) => call<DayView>(`/colleges/${enc(code)}/day?date=${enc(date)}`);

export const getChanges = (code: string, from: string, to: string) =>
  call<Change[]>(`/colleges/${enc(code)}/changes?from=${enc(from)}&to=${enc(to)}`);

export type NewLeave = { teacher_id?: string; date: string; start_period?: number; end_period?: number; reason: string };

/** Leave for anyone, approved at once (the Dean), or a teacher's own request (waits for their HOD). */
export const addLeave = (code: string, body: NewLeave, by: { admin: AdminAccess } | { member: MemberAccess }) =>
  call<Leave>(`/colleges/${enc(code)}/leaves`, {
    method: "POST",
    headers: "admin" in by ? asAdmin(by.admin) : asMember(by.member),
    body: JSON.stringify(body),
  });

export const getMyLeaves = (m: MemberAccess) => call<Leave[]>(`/colleges/${enc(m.college_code)}/my-leaves`, { headers: asMember(m) });

export const getHodView = (m: MemberAccess) => call<HodView>(`/colleges/${enc(m.college_code)}/hod`, { headers: asMember(m) });

/** The HOD of the teacher's department, or the Dean. */
export const decideLeave = (code: string, id: number, action: "approve" | "reject", note: string, by: { admin: AdminAccess } | { member: MemberAccess }) =>
  call<Leave>(`/colleges/${enc(code)}/leaves/${id}/decide`, {
    method: "POST",
    headers: "admin" in by ? asAdmin(by.admin) : asMember(by.member),
    body: JSON.stringify({ action, note }),
  });

export const LEAVE_STATUS: Record<Leave["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Not approved",
};

export const getCover = (a: StaffAuth, date: string) =>
  call<CoverView>(`/colleges/${enc(staffCode(a))}/cover?date=${enc(date)}`, { headers: staffHeaders(a) });

export const getRules = (a: StaffAuth) => call<Rules>(`/colleges/${enc(staffCode(a))}/rules`, { headers: staffHeaders(a) });

export const setRules = (a: AdminAccess, rules: Rules) =>
  call<Rules>(`/colleges/${enc(a.code)}/rules`, { method: "PUT", headers: asAdmin(a), body: JSON.stringify(rules) });

export const removeLeave = (a: AdminAccess, id: number) =>
  call<null>(`/colleges/${enc(a.code)}/leaves/${id}`, { method: "DELETE", headers: asAdmin(a) });

export const extraSlots = (a: StaffAuth, date: string, sectionId: string, teacherId: string) =>
  call<SlotOption[]>(
    `/colleges/${enc(staffCode(a))}/extra-slots?date=${enc(date)}&section_id=${enc(sectionId)}&teacher_id=${enc(teacherId)}`,
    { headers: staffHeaders(a) },
  );

export const addChange = (a: StaffAuth, body: NewChange) =>
  call<Change>(`/colleges/${enc(staffCode(a))}/changes`, { method: "POST", headers: staffHeaders(a), body: JSON.stringify(body) });

export const removeChange = (a: StaffAuth, id: number) =>
  call<null>(`/colleges/${enc(staffCode(a))}/changes/${id}`, { method: "DELETE", headers: staffHeaders(a) });

// ---------- Dates ----------

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** The next date (from today) whose weekday is `day` ("Monday" or "Mon"), for the ?now= demo clock. */
export function nextDateFor(day: string, from = new Date()): string {
  for (let i = 0; i < 7; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    if (d.toLocaleDateString("en-US", { weekday: "long" }).slice(0, 3).toLowerCase() === day.slice(0, 3).toLowerCase()) return isoDate(d);
  }
  return isoDate(from);
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// ---------- Words ----------

export function names(d: CollegeData) {
  const by = <T extends { id: string; name: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x.name || x.id]));
  const subjects = by(d.subjects);
  const teachers = by(d.teachers);
  const sections = by(d.sections);
  const rooms = by(d.rooms);
  return {
    subject: (id: string) => subjects.get(id) ?? id,
    teacher: (id: string | null) => (id ? (teachers.get(id) ?? id) : ""),
    section: (id: string) => (sections.get(id) && sections.get(id) !== id ? `${id} (${sections.get(id)})` : id),
    room: (id: string) => rooms.get(id) ?? id,
  };
}

export type ChangeViewer = { role: "section" | "teacher"; id: string } | { role: "admin" };

/** Whether a change is about this student's section or this teacher. */
export function affects(c: Change, me: ChangeViewer): boolean {
  if (me.role === "admin") return true;
  return me.role === "section" ? c.section_id === me.id : c.teacher_id === me.id || c.new_teacher_id === me.id;
}

/** One change in plain words, from the reader's side: "DBMS (period 3) is cancelled". */
export function changeText(c: Change, d: CollegeData, me: ChangeViewer): string {
  const n = names(d);
  const when = periodText(d, c.start_period, c.end_period).replace(/^P/, "p");
  const subject = `${n.subject(c.subject_id)}${c.class_kind === "lab" ? " lab" : ""}`;
  const forSection = me.role === "section" ? "" : ` for ${c.section_id}`;
  let text: string;
  if (c.kind === "cancel") {
    text = me.role === "teacher" && me.id === c.teacher_id
      ? `Your ${subject} class${forSection} (${when}) is cancelled.`
      : `${subject}${forSection} (${when}) is cancelled.`;
  } else if (c.kind === "substitute") {
    if (me.role === "teacher" && me.id === c.new_teacher_id) {
      text = `You’re taking ${subject}${forSection} in ${n.room(c.room_id)} (${when}), for ${n.teacher(c.teacher_id)}.`;
    } else if (me.role === "teacher" && me.id === c.teacher_id) {
      text = `Your ${subject} class${forSection} (${when}) is covered by ${n.teacher(c.new_teacher_id)}.`;
    } else {
      text = `Substitute: ${n.teacher(c.new_teacher_id)} takes ${subject}${forSection} (${when}) instead of ${n.teacher(c.teacher_id)}.`;
    }
  } else {
    const who = me.role === "teacher" && me.id === c.teacher_id ? "" : ` with ${n.teacher(c.teacher_id)}`;
    text = `Extra class: ${subject}${forSection} in ${n.room(c.room_id)}${who} (${when}).`;
  }
  return c.note ? `${text} Note: ${c.note}` : text;
}

export const TIER_TEXT: Record<Suggestion["tier"], string> = {
  subject: "Teaches this subject",
  department: "Same department",
  anyone: "Free then",
};
