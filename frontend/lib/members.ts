"use client";

// People with a role and their own private link (backend/app/members.py):
// a department's HOD (approves leave) and teachers (ask for leave).
// Links carry the key in the URL fragment (#…), which never reaches a server.

import { useEffect, useMemo, useState } from "react";
import { ApiError, call } from "./api";
import type { AdminAccess } from "./cloud";
import { readLocal, useLocal, writeLocal } from "./local";

export type Role = "hod" | "teacher";

export interface MemberInfo {
  role: Role | "incharge";
  name: string;
  department_id: string;
  department_name: string;
  teacher_id: string | null;
  college_name: string;
  college_code: string;
}

/** This device's access as a member: the link's key plus who it belongs to. */
export interface MemberAccess extends MemberInfo {
  key: string;
}

export interface HeadOut {
  department_id: string;
  department_name: string;
  name: string;
  has_link: boolean;
  key: string | null;
}

export interface TeacherLinkOut {
  teacher_id: string;
  name: string;
  department_id: string;
  has_link: boolean;
  key: string | null;
}

const enc = encodeURIComponent;
const asAdmin = (a: AdminAccess) => ({ "X-Admin-Key": a.key });
export const asMember = (m: Pick<MemberAccess, "key">) => ({ "X-Member-Key": m.key });

// ---------- API ----------

export const getMe = (code: string, key: string) => call<MemberInfo>(`/colleges/${enc(code)}/me`, { headers: { "X-Member-Key": key } });

export const listHeads = (a: AdminAccess) => call<HeadOut[]>(`/colleges/${enc(a.code)}/departments/heads`, { headers: asAdmin(a) });

export const makeHead = (a: AdminAccess, dept: string, name: string) =>
  call<HeadOut>(`/colleges/${enc(a.code)}/departments/${enc(dept)}/hod`, {
    method: "POST",
    headers: asAdmin(a),
    body: JSON.stringify({ name }),
  });

export const listTeacherLinks = (a: AdminAccess) =>
  call<TeacherLinkOut[]>(`/colleges/${enc(a.code)}/teachers/links`, { headers: asAdmin(a) });

export const makeTeacherLink = (a: AdminAccess, teacherId: string) =>
  call<TeacherLinkOut>(`/colleges/${enc(a.code)}/teachers/${enc(teacherId)}/link`, { method: "POST", headers: asAdmin(a) });

// ---------- Links ----------

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);
const PAGE: Record<Role, string> = { hod: "/hod", teacher: "/teacher" };

export const memberLink = (role: Role, code: string, key: string) => `${origin()}${PAGE[role]}#college=${enc(code)}&key=${enc(key)}`;

export function memberFromHash(hash: string): { code: string; key: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const code = p.get("college")?.trim();
  const key = p.get("key")?.trim();
  return code && key ? { code, key } : null;
}

// ---------- Browser storage ----------

const MEMBER_KEY = "timetable.member.v1"; // { hod?: MemberAccess, teacher?: MemberAccess }
const LINKS_KEY = "timetable.memberlinks.v1"; // admin: links made in this browser, by college then "hod:CSE" / "teacher:HK"

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The HOD or teacher link opened on this device: `undefined` while loading, `null` if none. */
export function useMemberAccess(role: Role): MemberAccess | null | undefined {
  const raw = useLocal(MEMBER_KEY);
  return useMemo(() => (raw === undefined ? undefined : (parse<Partial<Record<Role, MemberAccess>>>(raw)?.[role] ?? null)), [raw, role]);
}

export function setMemberAccess(role: Role, m: MemberAccess | null) {
  const all = parse<Partial<Record<Role, MemberAccess>>>(readLocal(MEMBER_KEY)) ?? {};
  if (m) all[role] = m;
  else delete all[role];
  writeLocal(MEMBER_KEY, JSON.stringify(all));
}

export function useSavedMemberLinks(code: string | undefined): Record<string, string> {
  const raw = useLocal(LINKS_KEY);
  return useMemo(() => (code && parse<Record<string, Record<string, string>>>(raw)?.[code]) || {}, [raw, code]);
}

export function saveMemberLink(code: string, id: string, link: string) {
  const all = parse<Record<string, Record<string, string>>>(readLocal(LINKS_KEY)) ?? {};
  all[code] = { ...all[code], [id]: link };
  writeLocal(LINKS_KEY, JSON.stringify(all));
}

const ROLE_NAME: Record<Role, string> = { hod: "an HOD", teacher: "a teacher" };

/**
 * Opening a member link (/hod#college=…&key=… or /teacher#…): check it with the
 * server, remember it on this device, and take the key out of the address bar.
 * Also works when a link is pasted while the page is already open.
 */
export function useOpenMemberLink(role: Role): { opening: boolean; error: string | null } {
  const [state, setState] = useState<{ opening: boolean; error: string | null }>({ opening: false, error: null });
  useEffect(() => {
    const open = () => {
      const link = memberFromHash(window.location.hash);
      if (!link) return;
      window.history.replaceState(null, "", window.location.pathname);
      setState({ opening: true, error: null });
      getMe(link.code, link.key)
        .then((info) => {
          if (info.role !== role) {
            setState({ opening: false, error: `This link is for ${info.role === "hod" ? "an HOD" : info.role === "teacher" ? "a teacher" : "someone else"}, not ${ROLE_NAME[role]}.` });
            return;
          }
          setMemberAccess(role, { ...info, role, key: link.key });
          setState({ opening: false, error: null });
        })
        .catch((e: unknown) => setState({ opening: false, error: e instanceof ApiError ? e.message : "Couldn't open this link." }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [role]);
  return state;
}
