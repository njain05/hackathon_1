"use client";

// Hall booking with digital approval (backend/app/bookings.py).
// Organisers need no login: their tracking link is the key to their request.
// Each approval step (HOD, Dean…) has its own secret link; the admin link may act for any step.

import { useMemo } from "react";
import { call } from "./api";
import type { AdminAccess } from "./cloud";
import type { MemberAccess } from "./members";
import { readLocal, useLocal, writeLocal } from "./local";
import { dayBlocks, formatTime } from "./periods";
import type { CollegeData, Room } from "./types";

export interface StepState {
  title: string;
  state: "approved" | "rejected" | "waiting" | "later";
}

export interface BookingAction {
  action: "approved" | "rejected" | "cancelled";
  step_title: string;
  by: string;
  note: string;
  at: string;
}

export interface Booking {
  id: number;
  token: string;
  room_id: string;
  room_name: string;
  date: string; // YYYY-MM-DD
  day: string;
  start_period: number;
  end_period: number;
  title: string;
  purpose: string;
  attendees: number;
  organiser: string;
  club: string;
  contact: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  waiting_for: string | null;
  waiting_since: string | null;
  steps: StepState[];
  history: BookingAction[];
  created_at: string;
  college_name: string;
  college_code: string;
}

export interface CalendarEvent {
  id: number;
  title: string;
  club: string;
  room_id: string;
  room_name: string;
  date: string;
  start_period: number;
  end_period: number;
}

export interface PeriodSlot {
  period: number;
  free: boolean;
  reason: "class" | "booked" | "requested" | null;
}

export interface Availability {
  room_id: string;
  date: string;
  day: string | null;
  periods: PeriodSlot[];
}

export interface Step {
  id: number | null;
  title: string;
  position: number;
  key: string | null;
}

export interface ApprovalsView {
  you: Step | null;
  steps: Step[];
  bookings: Booking[];
}

export interface NewBooking {
  room_id: string;
  date: string;
  start_period: number;
  end_period: number;
  title: string;
  purpose: string;
  attendees: number;
  organiser: string;
  club: string;
  contact: string;
}

/** Who is approving: the Dean (admin link), an HOD (their link), or an old per-step approver link. */
export type ApproverAuth =
  | { admin: Pick<AdminAccess, "code" | "key"> }
  | { member: Pick<MemberAccess, "college_code" | "key"> }
  | { code: string; key: string };

const enc = encodeURIComponent;
const authHeaders = (a: ApproverAuth): Record<string, string> =>
  "admin" in a ? { "X-Admin-Key": a.admin.key } : "member" in a ? { "X-Member-Key": a.member.key } : { "X-Approver-Key": a.key };
const authCode = (a: ApproverAuth) => ("admin" in a ? a.admin.code : "member" in a ? a.member.college_code : a.code);

// ---------- API ----------

export const getAvailability = (code: string, roomId: string, date: string) =>
  call<Availability>(`/colleges/${enc(code)}/availability?room_id=${enc(roomId)}&date=${enc(date)}`);

/** A teacher's request (their link) goes to their HOD, then the Dean; without a link (a student club) to the Dean. */
export const requestBooking = (code: string, b: NewBooking, teacher?: Pick<MemberAccess, "key"> | null) =>
  call<Booking>(`/colleges/${enc(code)}/bookings`, {
    method: "POST",
    headers: teacher ? { "X-Member-Key": teacher.key } : {},
    body: JSON.stringify(b),
  });

export const getMyBookings = (m: Pick<MemberAccess, "college_code" | "key">) =>
  call<Booking[]>(`/colleges/${enc(m.college_code)}/my-bookings`, { headers: { "X-Member-Key": m.key } });

export const trackBooking = (token: string) => call<Booking>(`/bookings/${enc(token)}`);

export const cancelBooking = (token: string) => call<Booking>(`/bookings/${enc(token)}/cancel`, { method: "POST" });

export const getEvents = (code: string, from?: string) =>
  call<CalendarEvent[]>(`/colleges/${enc(code)}/events${from ? `?from=${enc(from)}` : ""}`);

export const getApprovals = (a: ApproverAuth) =>
  call<ApprovalsView>(`/colleges/${enc(authCode(a))}/approvals`, { headers: authHeaders(a) });

export const decideBooking = (a: ApproverAuth, id: number, action: "approve" | "reject", note: string, by: string) =>
  call<Booking>(`/colleges/${enc(authCode(a))}/approvals/${id}`, {
    method: "POST",
    headers: authHeaders(a),
    body: JSON.stringify({ action, note, by }),
  });

export const setApprovalSteps = (a: AdminAccess, steps: { id: number | null; title: string }[]) =>
  call<Step[]>(`/colleges/${enc(a.code)}/approval-steps`, {
    method: "PUT",
    headers: { "X-Admin-Key": a.key },
    body: JSON.stringify(steps.map((s) => (s.id === null ? { title: s.title } : s))),
  });

export const newApproverLink = (a: AdminAccess, stepId: number) =>
  call<Step>(`/colleges/${enc(a.code)}/approval-steps/${stepId}/new-link`, { method: "POST", headers: { "X-Admin-Key": a.key } });

// ---------- Links ----------

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

export const trackLink = (token: string) => `${origin()}/track/${enc(token)}`;

/** One approver's secret link. Only that step can act with it. */
export const approverLink = (code: string, step: { title: string }, key: string) =>
  `${origin()}/approvals#college=${enc(code)}&step=${enc(step.title)}&key=${enc(key)}`;

export function approverFromHash(hash: string): { code: string; key: string; step: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const code = p.get("college")?.trim();
  const key = p.get("key")?.trim();
  return code && key ? { code, key, step: p.get("step") ?? "" } : null;
}

// ---------- Browser storage ----------

const APPROVER_KEY = "timetable.approver.v1"; // this browser's approver link
const MINE_KEY = "timetable.bookings.v1"; // tracking tokens of requests sent from this browser
const LINKS_KEY = "timetable.approverlinks.v1"; // admin: approver links made in this browser, by step id

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface ApproverAccess {
  code: string;
  key: string;
  step: string;
}

export function useApproverAccess(): ApproverAccess | null | undefined {
  const raw = useLocal(APPROVER_KEY);
  return useMemo(() => (raw === undefined ? undefined : parse<ApproverAccess>(raw)), [raw]);
}

export const setApproverAccess = (a: ApproverAccess | null) => writeLocal(APPROVER_KEY, a && JSON.stringify(a));

/** Requests sent from this browser, newest first: { token, title, code }. */
export function useMyBookings(): { token: string; title: string; code: string }[] | undefined {
  const raw = useLocal(MINE_KEY);
  return useMemo(() => (raw === undefined ? undefined : parse<{ token: string; title: string; code: string }[]>(raw) ?? []), [raw]);
}

export function rememberBooking(b: Booking) {
  const list = parse<{ token: string; title: string; code: string }[]>(readLocal(MINE_KEY)) ?? [];
  writeLocal(MINE_KEY, JSON.stringify([{ token: b.token, title: b.title, code: b.college_code }, ...list.filter((x) => x.token !== b.token)].slice(0, 30)));
}

/** A request opened again: update its title if it was sent from this browser; never add one only viewed here. */
export function refreshRememberedBooking(b: Booking) {
  const list = parse<{ token: string; title: string; code: string }[]>(readLocal(MINE_KEY)) ?? [];
  if (list.some((x) => x.token === b.token)) rememberBooking(b);
}

/** Approver links the admin made in this browser (keys are only shown once by the server). */
export function useSavedApproverLinks(code: string | undefined): Record<string, string> {
  const raw = useLocal(LINKS_KEY);
  return useMemo(() => {
    const all = parse<Record<string, Record<string, string>>>(raw) ?? {};
    return (code && all[code]) || {};
  }, [raw, code]);
}

export function saveApproverLink(code: string, stepId: number, link: string) {
  const all = parse<Record<string, Record<string, string>>>(readLocal(LINKS_KEY)) ?? {};
  all[code] = { ...all[code], [String(stepId)]: link };
  writeLocal(LINKS_KEY, JSON.stringify(all));
}

// ---------- Display ----------

export function eventRooms(d: CollegeData): Room[] {
  const uses = new Map(d.room_types.map((t) => [t.id, t.use]));
  return d.rooms.filter((r) => uses.get(r.type) === "event");
}

/** Every room can be booked in periods with no class: halls first, then the rest by type. */
export function bookableRooms(d: CollegeData): { room: Room; kind: string }[] {
  const types = new Map(d.room_types.map((t) => [t.id, t]));
  const rank = (r: Room) => (types.get(r.type)?.use === "event" ? 0 : types.get(r.type)?.use === "lecture" ? 1 : 2);
  return [...d.rooms]
    .sort((a, b) => rank(a) - rank(b) || (types.get(a.type)?.name ?? "").localeCompare(types.get(b.type)?.name ?? "") || a.id.localeCompare(b.id))
    .map((room) => ({ room, kind: types.get(room.type)?.name ?? room.type }));
}

/** "Periods 3–4, 11:40–13:20" from the college's own clock times. */
export function periodText(d: CollegeData, start: number, end: number): string {
  const periods = dayBlocks(d.settings).filter((b) => b.kind === "period");
  const a = periods[start - 1];
  const b = periods[end - 1];
  const which = start === end ? `Period ${start}` : `Periods ${start}–${end}`;
  return a && b ? `${which}, ${formatTime(a.start)}–${formatTime(b.end)}` : which;
}

export function dateText(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

/** Today in the browser's time zone, as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const STATUS_TEXT: Record<Booking["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Not approved",
  cancelled: "Cancelled",
};
