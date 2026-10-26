"use client";

// Who is using this device, as far as the app can tell without a login.
// Staff (the Dean, or whoever is creating a new college) see Setup, the full
// timetables and reports. HODs, in-charges and teachers see only their own
// pages, even if a setup draft was ever opened on their device.

import { useAdminAccess } from "./cloud";
import { useLocal } from "./local";
import { useMemberAccess } from "./members";

const DRAFT_KEY = "timetable.setup.v1"; // a setup started on this device (lib/store.tsx)
const VIEW_KEY = "timetable.college.v1"; // a college opened from a share link or code (lib/cloud.ts)

export interface Access {
  /** Holds the Dean's (admin) link, or is building a new college on a device with no member link. */
  staff: boolean;
  /** Code of the college opened as a student or teacher, if any. */
  viewing: string | null;
}

/** `undefined` until the browser has loaded what it remembers. */
export function useAccess(): Access | undefined {
  const admin = useAdminAccess();
  const draft = useLocal(DRAFT_KEY);
  const viewing = useLocal(VIEW_KEY);
  const hod = useMemberAccess("hod");
  const incharge = useMemberAccess("incharge");
  const teacher = useMemberAccess("teacher");
  const loading = [admin, draft, viewing, hod, incharge, teacher].some((x) => x === undefined);
  if (loading) return undefined;
  // The Dean's link always wins. A draft alone counts only for the first-time creator, before any links exist.
  const member = Boolean(hod || incharge || teacher);
  return { staff: Boolean(admin) || (Boolean(draft) && !member), viewing: viewing || null };
}
