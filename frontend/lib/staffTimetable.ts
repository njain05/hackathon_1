"use client";

import { useAdminAccess, useViewerTimetable } from "./cloud";
import { type StoredTimetable, useStoredTimetable } from "./result";

/**
 * The timetable the Dean's pages (Timetables, Reports) show: the one generated on
 * this device, or else the college's published one (e.g. signed in on another device).
 * `undefined` while loading, `null` if there is neither.
 */
export function useStaffTimetable(): { stored: StoredTimetable | null | undefined; published: boolean } {
  const local = useStoredTimetable();
  const admin = useAdminAccess();
  const { state } = useViewerTimetable(null, admin === undefined ? undefined : (admin?.code ?? null));
  if (local === undefined || admin === undefined) return { stored: undefined, published: false };
  if (local) return { stored: local, published: false };
  if (!admin) return { stored: null, published: false };
  if (state.kind === "loading") return { stored: undefined, published: false };
  if (state.kind === "published" && state.college.code === admin.code) return { stored: state.stored, published: true };
  return { stored: null, published: false };
}
