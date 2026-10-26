"use client";

// Hall booking with digital approval (backend/app/bookings.py).
// Organisers need no login: their tracking link is the key to their request.
// Each approval step (HOD, Dean…) has its own secret link; the admin link may act for any step.

import { useMemo } from "react";
import { call } from "./api";
import type { AdminAccess } from "./cloud";
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

/** Who is approving: the admin (their key) or one step's approver (that step's key). */
export type ApproverAuth = { admin: Pick<AdminAccess, "code" | "key"> } | { code: string; key: string };

const enc = encodeURIComponent;
const authHeaders = (a: ApproverAuth): Record<string, string> =>
  "admin" in a ? { "X-Admin-Key": a.admin.key } : { "X-Approver-Key": a.key };
const authCode = (a: ApproverAuth) => ("admin" in a ? a.admin.code : a.code);

// ---------- API ----------

export const getAvailability = (code: string, roomId: string, date: string) =>
  call<Availability>(`/colleges/${enc(code)}/availability?room_id=${enc(roomId)}&date=${enc(date)}`);

export const requestBooking = (code: string, b: NewBooking) =>
  call<Booking>(`/colleges/${enc(code)}/bookings`, { method: "POST", body: JSON.stringify(b) });

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

/** "2 hours", "3 days": how long something has been waiting. */
export function since(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
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
