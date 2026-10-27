"use client";

// Sign in with a username and password (backend/app/accounts.py). Signing in
// stores the same access the pages already use (the Dean's admin access, an
// HOD's / in-charge's / teacher's member access, or a student's college and
// section), so every page works as before; signing out removes all of it.

import { useMemo } from "react";
import { call } from "./api";
import { type AdminAccess, setAdminAccess, setViewedCollege } from "./cloud";
import { setApproverAccess } from "./bookings";
import { readLocal, useLocal, writeLocal } from "./local";
import { getMe, setMemberAccess } from "./members";

export type AccountRole = "dean" | "hod" | "incharge" | "teacher" | "student";

export const ROLE_NAME: Record<AccountRole, string> = {
  dean: "Dean",
  hod: "HOD",
  incharge: "Timetable in-charge",
  teacher: "Teacher",
  student: "Student",
};

/** Who is signed in on this device. */
export interface Account {
  username: string;
  name: string;
  role: AccountRole;
  college_code: string;
  college_name: string;
  /** Students: their section. */
  section_id?: string | null;
}

interface LoginOut {
  username: string;
  name: string;
  role: AccountRole;
  college_code: string;
  college_slug: string;
  college_name: string;
  key: string | null;
  department_id: string | null;
  teacher_id: string | null;
  section_id: string | null;
}

const ACCOUNT_KEY = "timetable.account.v1";
const ME_KEY = "timetable.me.v1"; // My timetable's chosen section or name (components/timetable/MyTimetable.tsx)
const CODE_KEY = "timetable.signin-college.v1"; // the college code typed on the sign-in page, to fill it in next time
const enc = encodeURIComponent;

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** `undefined` while loading, `null` when signed out. */
export function useAccount(): Account | null | undefined {
  const raw = useLocal(ACCOUNT_KEY);
  return useMemo(() => (raw === undefined ? undefined : parse<Account>(raw)), [raw]);
}

export const readAccount = () => parse<Account>(readLocal(ACCOUNT_KEY));

/** The college code last used to sign in on this device ("" if none). */
export const lastSignInCollege = () => readLocal(CODE_KEY) ?? "";

/** The page to open after signing in. */
export function homeFor(role: AccountRole): string {
  return { dean: "/today", hod: "/hod", incharge: "/department", teacher: "/teacher", student: "/my" }[role];
}

const SETUP_KEY = "timetable.setup.v1"; // the setup draft (lib/store.tsx)
const RESULT_KEY = "timetable.result.v1"; // the timetable generated here (lib/result.ts)

/** Remove every kind of access this device holds. */
function forgetAccess() {
  setAdminAccess(null);
  setMemberAccess("hod", null);
  setMemberAccess("incharge", null);
  setMemberAccess("teacher", null);
  setApproverAccess(null);
  setViewedCollege(null);
  writeLocal(ME_KEY, null);
  writeLocal(ACCOUNT_KEY, null);
}

/**
 * Sign out: this device forgets who was signed in and the Dean's setup copy, so the
 * next person on a shared computer sees nothing of theirs. (The Dean's setup autosaves
 * online, and comes back when they sign in again.)
 */
export function signOut() {
  forgetAccess();
  writeLocal(SETUP_KEY, null);
  writeLocal(RESULT_KEY, null);
}

/** Sign in, and store what this person's pages need. Throws ApiError with the server's message. */
export async function signIn(code: string, username: string, password: string): Promise<Account> {
  const ref = code.trim().replace(/\s+/g, "");
  const r = await call<LoginOut>(`/colleges/${enc(ref)}/login`, {
    method: "POST",
    body: JSON.stringify({ username: username.trim(), password }),
  });
  // A staff member's page details (department name and so on), checked with their key before anything is stored.
  const info = r.key && r.role !== "dean" && r.role !== "student" ? await getMe(r.college_code, r.key) : null;

  // One person per device: nothing left over from whoever used it before. Only a Dean keeps
  // the setup copy in this browser (it is theirs, or loads from online on Setup).
  forgetAccess();
  if (r.role !== "dean") {
    writeLocal(SETUP_KEY, null);
    writeLocal(RESULT_KEY, null);
  }
  if (r.role === "dean" && r.key) {
    setAdminAccess({ code: r.college_code, slug: r.college_slug, name: r.college_name, key: r.key } satisfies AdminAccess);
  } else if (info && r.key && (r.role === "hod" || r.role === "incharge" || r.role === "teacher")) {
    setMemberAccess(r.role, { ...info, role: r.role, key: r.key });
  }
  // Everyone sees their college's published timetable; a student sees their own section.
  setViewedCollege(r.college_code);
  if (r.role === "student" && r.section_id) {
    writeLocal(ME_KEY, JSON.stringify({ role: "section", id: r.section_id, ids: { section: r.section_id } }));
  } else if (r.role === "teacher" && r.teacher_id) {
    writeLocal(ME_KEY, JSON.stringify({ role: "teacher", id: r.teacher_id, ids: { teacher: r.teacher_id } }));
  }
  const account: Account = {
    username: r.username,
    name: r.name,
    role: r.role,
    college_code: r.college_code,
    college_name: r.college_name,
    section_id: r.section_id,
  };
  writeLocal(ACCOUNT_KEY, JSON.stringify(account));
  writeLocal(CODE_KEY, r.college_code);
  return account;
}

/** Change the signed-in person's password. Throws ApiError with the server's message. */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const a = readAccount();
  if (!a) throw new Error("Sign in first.");
  await call<null>(`/colleges/${enc(a.college_code)}/password`, {
    method: "POST",
    body: JSON.stringify({ username: a.username, old_password: oldPassword, new_password: newPassword }),
  });
}

// ---------- The Dean manages everyone's sign-ins ----------

export interface AccountRow {
  username: string;
  name: string;
  role: AccountRole;
  department_id: string | null;
  teacher_id: string | null;
  section_id: string | null;
  created_at: string;
}

/** A new sign-in: give this password to the person (it's shown only once). */
export interface MadeAccount {
  username: string;
  name: string;
  role: AccountRole;
  password: string;
}

export interface NewAccount {
  role: "hod" | "incharge" | "teacher" | "student";
  username: string;
  name?: string;
  department_id?: string;
  teacher_id?: string;
  section_id?: string;
  /** Leave out for an easy-to-type generated one. */
  password?: string;
}

const asAdmin = (a: Pick<AdminAccess, "key">) => ({ "X-Admin-Key": a.key });

/** The Dean chooses their own username and password (needs the admin access on this device). */
export const setDeanSignIn = (a: AdminAccess, username: string, password: string, name = "Dean") =>
  call<AccountRow>(`/colleges/${enc(a.code)}/accounts/dean`, {
    method: "POST",
    headers: asAdmin(a),
    body: JSON.stringify({ username, password, name }),
  });

export const listAccounts = (a: AdminAccess) => call<AccountRow[]>(`/colleges/${enc(a.code)}/accounts`, { headers: asAdmin(a) });

export const createAccount = (a: AdminAccess, body: NewAccount) =>
  call<MadeAccount>(`/colleges/${enc(a.code)}/accounts`, { method: "POST", headers: asAdmin(a), body: JSON.stringify(body) });

/** Many teachers or students at once; rows that can't be made are named in `problems`. */
export const createAccounts = (
  a: AdminAccess,
  role: "teacher" | "student",
  rows: { username: string; name?: string; section_id?: string; teacher_id?: string }[],
) =>
  call<{ made: MadeAccount[]; problems: string[] }>(`/colleges/${enc(a.code)}/accounts/bulk`, {
    method: "POST",
    headers: asAdmin(a),
    body: JSON.stringify({ role, rows }),
  });

export const resetPassword = (a: AdminAccess, username: string) =>
  call<MadeAccount>(`/colleges/${enc(a.code)}/accounts/${enc(username)}/reset`, { method: "POST", headers: asAdmin(a) });

export const deleteAccount = (a: AdminAccess, username: string) =>
  call<null>(`/colleges/${enc(a.code)}/accounts/${enc(username)}`, { method: "DELETE", headers: asAdmin(a) });

/** The HOD (with their member access) makes the department's timetable in-charge sign-in. */
export const makeInchargeAccount = (code: string, memberKey: string, dept: string, username: string, name: string) =>
  call<MadeAccount>(`/colleges/${enc(code)}/departments/${enc(dept)}/incharge-account`, {
    method: "POST",
    headers: { "X-Member-Key": memberKey },
    body: JSON.stringify({ username, name }),
  });
