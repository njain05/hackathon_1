"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CollegeData } from "./types";

const STORAGE_KEY = "timetable.setup.v1";

export type RefKind = "department" | "room" | "teacher" | "section" | "subject" | "room_type";

/** When a code changes, update every place that refers to it. */
export function renameRefs(d: CollegeData, kind: RefKind, from: string, to: string): CollegeData {
  if (!from || from === to) return d;
  const sw = (v: string) => (v === from ? to : v);
  const swn = (v: string | null) => (v === from ? to : v);
  switch (kind) {
    case "department":
      return {
        ...d,
        sections: d.sections.map((x) => ({ ...x, department_id: sw(x.department_id) })),
        subjects: d.subjects.map((x) => ({ ...x, department_id: sw(x.department_id) })),
        teachers: d.teachers.map((x) => ({ ...x, department_id: sw(x.department_id) })),
        rooms: d.rooms.map((x) => ({ ...x, department_id: swn(x.department_id) })),
      };
    case "teacher":
      return {
        ...d,
        assignments: d.assignments.map((a) => ({
          ...a,
          teacher_id: sw(a.teacher_id),
          lab_teacher_id: swn(a.lab_teacher_id),
        })),
      };
    case "section":
      return { ...d, assignments: d.assignments.map((a) => ({ ...a, section_id: sw(a.section_id) })) };
    case "subject":
      return { ...d, assignments: d.assignments.map((a) => ({ ...a, subject_id: sw(a.subject_id) })) };
    case "room_type":
      return {
        ...d,
        rooms: d.rooms.map((r) => ({ ...r, type: sw(r.type) })),
        subjects: d.subjects.map((s) => ({ ...s, lab_room_type: swn(s.lab_room_type) })),
      };
    case "room":
      return d;
  }
}

interface Store {
  /** null until the admin picks a starting template (or loads saved work). */
  data: CollegeData | null;
  loaded: boolean;
  setData: (update: (d: CollegeData) => CollegeData) => void;
  replaceData: (d: CollegeData | null) => void;
}

const Ctx = createContext<Store | null>(null);

export function CollegeProvider({ children }: { children: React.ReactNode }) {
  const [data, setState] = useState<CollegeData | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load the saved draft after mount (localStorage isn't available on the server).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load from browser storage
      if (raw) setState(JSON.parse(raw) as CollegeData);
    } catch {
      // storage blocked or corrupt: start fresh
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (data) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage full or blocked: the app still works, it just won't remember
    }
  }, [data, loaded]);

  const setData = useCallback((update: (d: CollegeData) => CollegeData) => {
    setState((d) => (d ? update(d) : d));
  }, []);

  return (
    <Ctx.Provider value={{ data, loaded, setData, replaceData: setState }}>{children}</Ctx.Provider>
  );
}

export function useCollege(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useCollege must be used inside CollegeProvider");
  return s;
}
