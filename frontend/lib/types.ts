// Mirrors backend/solver/models.py. Keep the two in sync.

export type RoomUse = "lecture" | "lab" | "event";

export interface RoomType {
  id: string;
  name: string;
  use: RoomUse;
}

export interface Break {
  name: string;
  after_period: number;
  minutes: number;
  labs_continue: boolean;
}

export interface Settings {
  days: string[];
  periods_per_day: number;
  day_start: string; // "HH:MM"
  period_minutes: number;
  period_lengths: number[] | null;
  breaks: Break[];
}

export interface Department {
  id: string;
  name: string;
}

export interface Section {
  id: string;
  name: string;
  department_id: string;
  strength: number;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  department_id: string;
  lecture_hours: number;
  lab_hours: number;
  lab_block_length: number;
  lab_room_type: string | null;
}

export interface Slot {
  day: string;
  period: number;
}

export interface Teacher {
  id: string;
  name: string;
  department_id: string;
  max_periods_per_day: number | null;
  unavailable: Slot[];
}

export interface Assignment {
  section_id: string;
  subject_id: string;
  teacher_id: string;
  lab_teacher_id: string | null;
}

export interface Room {
  id: string;
  name: string;
  type: string;
  capacity: number;
  department_id: string | null;
}

export interface CollegeData {
  name: string;
  settings: Settings;
  room_types: RoomType[];
  departments: Department[];
  sections: Section[];
  subjects: Subject[];
  teachers: Teacher[];
  assignments: Assignment[];
  rooms: Room[];
}

export type StepId = "week" | "rooms" | "teachers" | "sections" | "subjects" | "review";

export interface Problem {
  kind: string;
  message: string;
  suggestion: string;
  step: StepId | null;
}

export interface Entry {
  day: string;
  period: number;
  section_id: string;
  subject_id: string;
  teacher_id: string;
  room_id: string;
  kind: "lecture" | "lab";
}

export interface SolveResult {
  status: "solved" | "infeasible" | "invalid" | "timeout";
  entries: Entry[];
  problems: Problem[];
  stats: {
    solver_status: string;
    optimal: boolean;
    wall_time_seconds: number;
    score: number;
    penalties: Record<string, number>;
  } | null;
  check: { ok: boolean; clashes: { message: string }[]; violations: { message: string }[] } | null;
}
