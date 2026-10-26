"use client";

// Who is using this device, as far as the app can tell without a login.
// Staff (timetable makers) see Setup and the full timetables; students and
// teachers who opened a share link see only their own views.

import { useAdminAccess } from "./cloud";
import { useLocal } from "./local";

const DRAFT_KEY = "timetable.setup.v1"; // a setup started on this device (lib/store.tsx)
const VIEW_KEY = "timetable.college.v1"; // a college opened from a share link or code (lib/cloud.ts)

export interface Access {
  /** Holds the admin link, or is building a college on this device. */
  staff: boolean;
  /** Code of the college opened as a student or teacher, if any. */
  viewing: string | null;
}

/** `undefined` until the browser has loaded what it remembers. */
export function useAccess(): Access | undefined {
  const admin = useAdminAccess();
  const draft = useLocal(DRAFT_KEY);
  const viewing = useLocal(VIEW_KEY);
  if (admin === undefined || draft === undefined || viewing === undefined) return undefined;
  return { staff: Boolean(admin) || Boolean(draft), viewing: viewing || null };
}
