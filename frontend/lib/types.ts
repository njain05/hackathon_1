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
  /** Which control edits it. Older setups don't have it (then the name decides). The server ignores it. */
  kind?: "lunch" | "tea" | "other";
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
  /** Fair-load cap. Optional: setups saved before it existed don't have it. */
  max_periods_per_week?: number | null;
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
  /** Other departments allowed to use this department's room (approved by its HOD). */
  shared_with?: string[];
}

/** One choice inside an open elective, e.g. "AI for Everyone" by Dr. X. */
export interface ElectiveOption {
  subject_id: string;
  teacher_id: string;
  students: number;
}

/** Students of these sections split into parallel classes at the same time. */
export interface ElectiveGroup {
  id: string;
  name: string;
  section_ids: string[];
  periods_per_week: number;
  options: ElectiveOption[];
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
  /** Optional: setups saved before open electives existed don't have it. */
  elective_groups?: ElectiveGroup[];
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
  kind: "lecture" | "lab" | "elective";
  /** For electives: the group id (section_id is the group id too). */
  elective_group?: string | null;
  /** For electives: the member sections. */
  elective_sections?: string[] | null;
}

export interface Issue {
  kind: string; // teacher_clash | section_clash | room_clash | capacity | ...
  message: string;
  day: string | null;
  period: number | null;
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
  check: { ok: boolean; clashes: Issue[]; violations: Issue[] } | null;
}
