"use client";

import { useMemo } from "react";
import { useLocal, writeLocal } from "./local";
import type { CollegeData, SolveResult } from "./types";

const RESULT_KEY = "timetable.result.v1";

/** The last generated timetable, with a snapshot of the data it was made from. */
export interface StoredTimetable {
  data: CollegeData;
  result: SolveResult;
  at: string; // ISO time it was generated
}

export function saveTimetable(t: StoredTimetable): boolean {
  return writeLocal(RESULT_KEY, JSON.stringify(t));
}

/** Forget the generated timetable in this browser (the setup data stays). */
export function clearTimetable(): void {
  writeLocal(RESULT_KEY, null);
}

/**
 * The saved timetable. `undefined` while loading (server render / first paint),
 * `null` if nothing has been generated yet.
 */
export function useStoredTimetable(): StoredTimetable | null | undefined {
  const raw = useLocal(RESULT_KEY);
  return useMemo(() => {
    if (raw === undefined) return undefined;
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as StoredTimetable;
      return t.result?.status === "solved" ? t : null;
    } catch {
      return null;
    }
  }, [raw]);
}
