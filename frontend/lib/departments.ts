"use client";

// Departments run their own part of the setup (backend/app/departments.py):
// the HOD appoints a timetable in-charge, both edit only their department,
// the in-charge sends it to the HOD, the HOD approves it (or sends it back),
// and the Dean generates once every department with an HOD is approved.

import { call } from "./api";
import type { AdminAccess } from "./cloud";
import { asMember, type MemberAccess } from "./members";
import type { CollegeData } from "./types";

const enc = encodeURIComponent;

/** Who is calling: the Dean (admin link), or an HOD / in-charge with their own link. */
export type Staff = { admin: AdminAccess } | { member: MemberAccess };

export const staffCode = (s: Staff) => ("admin" in s ? s.admin.code : s.member.college_code);
/** A string that changes only when the person (link) changes: safe to use as an effect dependency. */
export const staffId = (s: Staff) => ("admin" in s ? `admin:${s.admin.code}:${s.admin.key}` : `member:${s.member.college_code}:${s.member.key}`);
const headers = (s: Staff) => ("admin" in s ? { "X-Admin-Key": s.admin.key } : asMember(s.member));

export interface DepartmentSetup {
  department_id: string;
  department_name: string;
  role: "admin" | "hod" | "incharge";
  data: CollegeData;
  updated_at: string;
}

export interface SavedDepartment {
  updated_at: string;
  ignored: string[];
  /** The department was approved or waiting for the HOD; this change put it back to draft. */
  reopened: boolean;
}

export interface InchargeOut {
  department_id: string;
  name: string | null;
  since: string | null;
  key: string | null;
}

export type ReviewState = "draft" | "submitted" | "approved" | "returned";

/** Names, notes and "by" are filled in only for your own department (the Dean sees all). */
export interface DepartmentState {
  department_id: string;
  department_name: string;
  state: ReviewState;
  note: string;
  updated_at: string | null;
  updated_by: string;
  hod: string | null;
  incharge: string | null;
  /** It has an HOD, so the Dean waits for the HOD's approval before generating. */
  needs_approval: boolean;
}

export interface RoomRequest {
  id: number;
  room_id: string;
  room_name: string;
  owner_department: string;
  for_department: string;
  reason: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected";
  decided_by: string;
  note: string;
  created_at: string;
  decided_at: string | null;
}

const base = (s: Staff) => `/colleges/${enc(staffCode(s))}`;

export const getDepartmentSetup = (s: Staff, dept: string) =>
  call<DepartmentSetup>(`${base(s)}/departments/${enc(dept)}/setup`, { headers: headers(s) });

/** `based`: the setup as this page last loaded or saved it; if someone else changed the department since, the server refuses (409). */
export const saveDepartmentSetup = (s: Staff, dept: string, data: CollegeData, based?: CollegeData | null) =>
  call<SavedDepartment>(`${base(s)}/departments/${enc(dept)}/setup`, {
    method: "PUT",
    headers: headers(s),
    body: JSON.stringify({ data, base: based ?? null }),
  });

export const getIncharge = (s: Staff, dept: string) =>
  call<InchargeOut>(`${base(s)}/departments/${enc(dept)}/incharge`, { headers: headers(s) });

export const makeIncharge = (s: Staff, dept: string, name: string, teacherId: string | null) =>
  call<InchargeOut>(`${base(s)}/departments/${enc(dept)}/incharge`, {
    method: "POST",
    headers: headers(s),
    body: JSON.stringify({ name, teacher_id: teacherId }),
  });

export const departmentStatus = (s: Staff) => call<DepartmentState[]>(`${base(s)}/departments/status`, { headers: headers(s) });

export const submitDepartment = (s: Staff, dept: string, note = "") =>
  call<DepartmentState>(`${base(s)}/departments/${enc(dept)}/submit`, {
    method: "POST",
    headers: headers(s),
    body: JSON.stringify({ note }),
  });

/** HOD (or Dean): approve the department's data, or send it back with a note. */
export const reviewDepartment = (s: Staff, dept: string, approve: boolean, note = "") =>
  call<DepartmentState>(`${base(s)}/departments/${enc(dept)}/review`, {
    method: "POST",
    headers: headers(s),
    body: JSON.stringify({ approve, note }),
  });

/** Plain words for a review state. */
export const STATE_TEXT: Record<ReviewState, string> = {
  draft: "Being prepared",
  submitted: "Waiting for the HOD",
  approved: "Approved by the HOD",
  returned: "Sent back by the HOD",
};

/** Departments the Dean is still waiting on before generating (only those with an HOD). */
export const waitingOn = (all: DepartmentState[]) => all.filter((d) => d.needs_approval && d.state !== "approved");

export const listRoomRequests = (s: Staff) => call<RoomRequest[]>(`${base(s)}/room-requests`, { headers: headers(s) });

export const requestRoom = (s: Staff, roomId: string, forDepartment: string, reason: string) =>
  call<RoomRequest>(`${base(s)}/room-requests`, {
    method: "POST",
    headers: headers(s),
    body: JSON.stringify({ room_id: roomId, for_department: forDepartment, reason }),
  });

export const decideRoomRequest = (s: Staff, id: number, approve: boolean, note: string) =>
  call<RoomRequest>(`${base(s)}/room-requests/${id}/decide`, {
    method: "POST",
    headers: headers(s),
    body: JSON.stringify({ approve, note }),
  });

/** The link an in-charge opens: their department's setup. */
export const inchargeLink = (code: string, key: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/department#college=${enc(code)}&key=${enc(key)}`;
