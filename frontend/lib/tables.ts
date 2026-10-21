// Column definitions for every setup table. One definition drives the
// on-screen table, Excel/CSV templates, file import and paste-from-Excel,
// so they always agree.

import type {
  Assignment,
  CollegeData,
  Department,
  Room,
  Section,
  Slot,
  Subject,
  Teacher,
} from "./types";
import type { RefKind } from "./store";
import { shortDay } from "./periods";

export interface Option {
  value: string;
  label: string;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Other header names accepted on import, e.g. "Room no." for "Room code". */
  aliases?: string[];
  kind: "text" | "number" | "select" | "readonly";
  required?: boolean;
  advanced?: boolean;
  placeholder?: string;
  help?: string;
  width?: string;
  /** For select columns. An empty-value option means "none". */
  options?: (d: CollegeData) => Option[];
  /** What a select column writes to Excel: its code (default) or its label. */
  exportAs?: "value" | "label";
  get: (row: T, d: CollegeData) => string;
  /** Returns the updated row, or an error message for import. */
  set: (row: T, raw: string, d: CollegeData) => T | string;
}

export interface TableSpec<T> {
  id: "departments" | "rooms" | "teachers" | "sections" | "subjects" | "assignments";
  sheet: string; // Excel sheet name
  noun: string; // "room", used in messages
  /** The column holding the row's code, and which references it renames. */
  codeKey?: string;
  refKind?: RefKind;
  columns: Column<T>[];
  blank: (d: CollegeData) => T;
  /** Identity used to merge imported rows into existing ones. */
  identity: (row: T) => string;
  rows: (d: CollegeData) => T[];
  withRows: (d: CollegeData, rows: T[]) => CollegeData;
}

// ---------- Cell helpers ----------

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Match typed text against options by code or by name, ignoring case. */
export function matchOption(raw: string, options: Option[]): Option | undefined {
  const r = norm(raw);
  return (
    options.find((o) => norm(o.value) === r) ??
    options.find((o) => norm(o.label) === r) ??
    options.find((o) => o.value && norm(o.label).startsWith(r + " "))
  );
}

function text<T>(
  key: keyof T & string,
  header: string,
  extra: Partial<Column<T>> = {},
): Column<T> {
  return {
    key,
    header,
    kind: "text",
    get: (row) => String(row[key] ?? ""),
    set: (row, raw) => {
      const v = raw.trim();
      if (extra.required && !v) return `${header} is missing.`;
      return { ...row, [key]: v };
    },
    ...extra,
  };
}

function num<T>(
  key: keyof T & string,
  header: string,
  opts: { min?: number; optional?: boolean } & Partial<Column<T>> = {},
): Column<T> {
  const { min = 0, optional = false, ...extra } = opts;
  return {
    key,
    header,
    kind: "number",
    width: "7rem",
    get: (row) => (row[key] == null ? "" : String(row[key])),
    set: (row, raw) => {
      const v = raw.trim();
      if (!v) {
        if (optional) return { ...row, [key]: null };
        return extra.required ? `${header} is missing.` : { ...row, [key]: 0 };
      }
      const n = Number(v);
      if (!Number.isInteger(n)) return `${header} must be a whole number, not "${v}".`;
      if (n < min) return `${header} must be at least ${min}.`;
      return { ...row, [key]: n };
    },
    ...extra,
  };
}

function ref<T>(
  key: keyof T & string,
  header: string,
  options: (d: CollegeData) => Option[],
  opts: { optional?: boolean; noneLabel?: string } & Partial<Column<T>> = {},
): Column<T> {
  const { optional = false, noneLabel = "", ...extra } = opts;
  const withNone = (d: CollegeData) =>
    optional ? [{ value: "", label: noneLabel || "None" }, ...options(d)] : options(d);
  return {
    key,
    header,
    kind: "select",
    options: withNone,
    get: (row, d) => {
      const v = (row[key] as string | null) ?? "";
      return withNone(d).find((o) => o.value === v)?.label ?? v;
    },
    set: (row, raw, d) => {
      const v = raw.trim();
      if (!v || (optional && norm(v) === norm(noneLabel))) {
        if (optional) return { ...row, [key]: null };
        return `${header} is missing.`;
      }
      const hit = matchOption(v, options(d));
      if (!hit) {
        const known = options(d).slice(0, 6).map((o) => o.value).join(", ");
        return `${header} "${v}" isn't in the list${known ? ` (for example ${known})` : ""}. Add it first or check the spelling.`;
      }
      return { ...row, [key]: hit.value };
    },
    ...extra,
  };
}

const departmentOptions = (d: CollegeData): Option[] =>
  d.departments.map((x) => ({ value: x.id, label: `${x.id} – ${x.name}` }));

// ---------- Teacher availability: "Mon 1-2, Fri 7" ----------

export function formatSlots(slots: Slot[], d: CollegeData): string {
  const byDay = new Map<string, number[]>();
  for (const s of slots) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s.period]);
  return d.settings.days
    .filter((day) => byDay.has(day))
    .map((day) => {
      const ps = [...new Set(byDay.get(day))].sort((a, b) => a - b);
      if (ps.length === d.settings.periods_per_day) return `${shortDay(day)} all day`;
      const runs: string[] = [];
      for (let i = 0; i < ps.length; ) {
        let j = i;
        while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
        runs.push(i === j ? `${ps[i]}` : `${ps[i]}-${ps[j]}`);
        i = j + 1;
      }
      return `${shortDay(day)} ${runs.join(" ")}`;
    })
    .join(", ");
}

export function parseSlots(raw: string, d: CollegeData): Slot[] | string {
  const out: Slot[] = [];
  const parts = raw.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z]+)\s*(.*)$/);
    if (!m) return `Can't read "${part}". Write it like "Mon 1-2, Fri 7".`;
    const word = m[1].toLowerCase();
    const day = d.settings.days.find((x) => x.toLowerCase().startsWith(word.slice(0, 3)));
    if (!day || word.length < 2) return `"${m[1]}" isn't a working day.`;
    const rest = m[2].trim().toLowerCase();
    const n = d.settings.periods_per_day;
    if (!rest || rest === "all" || rest === "all day") {
      for (let p = 1; p <= n; p++) out.push({ day, period: p });
      continue;
    }
    for (const tok of rest.split(/\s+/)) {
      const r = tok.match(/^(\d+)(?:-(\d+))?$/);
      if (!r) return `Can't read periods "${tok}" for ${day}. Use numbers like 1-2 or 7.`;
      const a = Number(r[1]);
      const b = Number(r[2] ?? r[1]);
      if (a < 1 || b > n || a > b) return `${day} periods ${tok} are outside 1–${n}.`;
      for (let p = a; p <= b; p++) out.push({ day, period: p });
    }
  }
  return out;
}

// ---------- Tables ----------

export const departmentsTable: TableSpec<Department> = {
  id: "departments",
  sheet: "Departments",
  noun: "department",
  codeKey: "id",
  refKind: "department",
  columns: [
    text("id", "Code", { required: true, aliases: ["Dept code", "Short name"], placeholder: "CSE", width: "9rem" }),
    text("name", "Department name", { required: true, aliases: ["Name", "Department"], placeholder: "Computer Science & Engineering" }),
  ],
  blank: () => ({ id: "", name: "" }),
  identity: (r) => norm(r.id),
  rows: (d) => d.departments,
  withRows: (d, rows) => ({ ...d, departments: rows }),
};

export const roomsTable: TableSpec<Room> = {
  id: "rooms",
  sheet: "Rooms",
  noun: "room",
  codeKey: "id",
  refKind: "room",
  columns: [
    text("id", "Room code", { required: true, aliases: ["Room", "Room no", "Room no.", "Room number", "Code"], placeholder: "C-101", width: "9rem" }),
    ref("type", "Type", (d) => d.room_types.map((t) => ({ value: t.id, label: t.name })), {
      required: true,
      aliases: ["Room type", "Kind"],
      exportAs: "label",
    }),
    num("capacity", "Seats", { required: true, min: 1, aliases: ["Capacity", "Strength"] }),
    ref("department_id", "Department", departmentOptions, {
      optional: true,
      noneLabel: "Shared",
      aliases: ["Dept", "Belongs to"],
      help: "Leave as Shared if any department can use it.",
    }),
    text("name", "Name (optional)", { aliases: ["Name", "Room name"], placeholder: "Lecture Theatre 1" }),
  ],
  blank: (d) => ({
    id: "",
    name: "",
    type: d.room_types.find((t) => t.use === "lecture")?.id ?? d.room_types[0]?.id ?? "",
    capacity: 60,
    department_id: null,
  }),
  identity: (r) => norm(r.id),
  rows: (d) => d.rooms,
  withRows: (d, rows) => ({ ...d, rooms: rows }),
};

export const teachersTable: TableSpec<Teacher> = {
  id: "teachers",
  sheet: "Teachers",
  noun: "teacher",
  codeKey: "id",
  refKind: "teacher",
  columns: [
    text("id", "Short code", { required: true, aliases: ["Code", "Initials", "Teacher code"], placeholder: "HK", width: "8rem" }),
    text("name", "Full name", { required: true, aliases: ["Name", "Teacher", "Teacher name"], placeholder: "Dr. Harpreet Kaur" }),
    ref("department_id", "Department", departmentOptions, { required: true, aliases: ["Dept"] }),
    num("max_periods_per_day", "Max periods a day", {
      optional: true,
      min: 1,
      advanced: true,
      aliases: ["Max per day", "Max periods/day"],
      help: "Leave blank for no limit.",
    }),
    {
      key: "unavailable",
      header: "Not available",
      aliases: ["Unavailable", "Not free", "Busy"],
      kind: "text",
      advanced: true,
      placeholder: "Mon 1-2, Fri 7",
      help: 'Periods they can\'t teach, e.g. "Mon 1-2, Sat all day".',
      get: (row, d) => formatSlots(row.unavailable, d),
      set: (row, raw, d) => {
        const slots = parseSlots(raw, d);
        return typeof slots === "string" ? slots : { ...row, unavailable: slots };
      },
    },
  ],
  blank: (d) => ({
    id: "",
    name: "",
    department_id: d.departments[0]?.id ?? "",
    max_periods_per_day: null,
    unavailable: [],
  }),
  identity: (r) => norm(r.id),
  rows: (d) => d.teachers,
  withRows: (d, rows) => ({ ...d, teachers: rows }),
};

export const sectionsTable: TableSpec<Section> = {
  id: "sections",
  sheet: "Sections",
  noun: "section",
  codeKey: "id",
  refKind: "section",
  columns: [
    text("id", "Section code", { required: true, aliases: ["Section", "Class", "Code"], placeholder: "CSE-3A", width: "9rem" }),
    ref("department_id", "Department", departmentOptions, { required: true, aliases: ["Dept"] }),
    num("strength", "Students", { required: true, min: 1, aliases: ["Strength", "Students count"] }),
    text("name", "Name (optional)", { aliases: ["Name", "Section name"], placeholder: "CSE 3rd Sem A" }),
  ],
  blank: (d) => ({ id: "", name: "", department_id: d.departments[0]?.id ?? "", strength: 60 }),
  identity: (r) => norm(r.id),
  rows: (d) => d.sections,
  withRows: (d, rows) => ({ ...d, sections: rows }),
};

export const subjectsTable: TableSpec<Subject> = {
  id: "subjects",
  sheet: "Subjects",
  noun: "subject",
  codeKey: "id",
  refKind: "subject",
  columns: [
    {
      ...text<Subject>("id", "Subject code", { required: true, aliases: ["Code", "Course code", "Paper code"], placeholder: "CS201", width: "8rem" }),
      set: (row, raw) => {
        const v = raw.trim();
        return v ? { ...row, id: v, code: v } : "Subject code is missing.";
      },
    },
    text("name", "Subject name", { required: true, aliases: ["Name", "Subject", "Course"], placeholder: "Data Structures" }),
    ref("department_id", "Department", departmentOptions, { required: true, aliases: ["Dept"] }),
    num("lecture_hours", "Lectures a week", { aliases: ["Lectures", "Lecture hours", "Theory", "L"] }),
    num("lab_hours", "Lab periods a week", { aliases: ["Lab", "Lab hours", "Practical", "P"] }),
    num("lab_block_length", "Lab block", {
      min: 1,
      advanced: true,
      aliases: ["Lab block length", "Periods per lab"],
      help: "How many periods in a row one lab session takes. Usually 2.",
    }),
    ref(
      "lab_room_type",
      "Lab room type",
      (d) => d.room_types.filter((t) => t.use === "lab").map((t) => ({ value: t.id, label: t.name })),
      { optional: true, noneLabel: "Any lab", advanced: true, aliases: ["Lab type", "Lab room"], exportAs: "label" },
    ),
  ],
  blank: (d) => ({
    id: "",
    code: "",
    name: "",
    department_id: d.departments[0]?.id ?? "",
    lecture_hours: 3,
    lab_hours: 0,
    lab_block_length: 2,
    lab_room_type: null,
  }),
  identity: (r) => norm(r.id),
  rows: (d) => d.subjects,
  withRows: (d, rows) => ({ ...d, subjects: rows }),
};

const teacherOptions = (d: CollegeData): Option[] =>
  d.teachers.map((t) => ({ value: t.id, label: `${t.id} – ${t.name}` }));

export const assignmentsTable: TableSpec<Assignment> = {
  id: "assignments",
  sheet: "Who teaches what",
  noun: "class",
  columns: [
    ref("section_id", "Section", (d) => d.sections.map((s) => ({ value: s.id, label: s.id })), {
      required: true,
      aliases: ["Class", "Section code"],
      width: "9rem",
    }),
    ref(
      "subject_id",
      "Subject",
      (d) => d.subjects.map((s) => ({ value: s.id, label: `${s.id} – ${s.name}` })),
      { required: true, aliases: ["Subject code", "Course"] },
    ),
    ref("teacher_id", "Teacher", teacherOptions, { required: true, aliases: ["Teacher code", "Faculty"] }),
    ref("lab_teacher_id", "Lab teacher", teacherOptions, {
      optional: true,
      noneLabel: "Same teacher",
      advanced: true,
      aliases: ["Lab faculty"],
      help: "Only if someone else takes the lab.",
    }),
    {
      key: "load",
      header: "Periods a week",
      kind: "readonly",
      width: "8rem",
      get: (row, d) => {
        const s = d.subjects.find((x) => x.id === row.subject_id);
        if (!s) return "";
        return s.lab_hours ? `${s.lecture_hours} + ${s.lab_hours} lab` : String(s.lecture_hours);
      },
      set: (row) => row,
    },
  ],
  blank: (d) => ({
    section_id: d.sections[0]?.id ?? "",
    subject_id: "",
    teacher_id: "",
    lab_teacher_id: null,
  }),
  identity: (r) => `${norm(r.section_id)}|${norm(r.subject_id)}`,
  rows: (d) => d.assignments,
  withRows: (d, rows) => ({ ...d, assignments: rows }),
};

/** In dependency order: each table's references must exist before it's imported. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_TABLES: TableSpec<any>[] = [
  departmentsTable,
  roomsTable,
  teachersTable,
  sectionsTable,
  subjectsTable,
  assignmentsTable,
];

// ---------- Import ----------

export interface RowError {
  sheet: string;
  row: number; // spreadsheet row number, as the admin sees it
  message: string;
}

export interface ImportResult {
  data: CollegeData;
  added: number;
  updated: number;
  errors: RowError[];
}

function headerMatches<T>(cell: string, col: Column<T>): boolean {
  const c = norm(cell).replace(/\*$/, "").trim();
  return [col.header, ...(col.aliases ?? [])].some((h) => norm(h) === c);
}

/**
 * Turn a grid of cells (from a file or a paste) into rows of a table.
 * Uses the header row if there is one, otherwise column order as on screen.
 * Rows with errors are skipped and reported; good rows are merged in
 * (same code = update, new code = add).
 */
export function importGrid<T>(
  spec: TableSpec<T>,
  grid: string[][],
  d: CollegeData,
  firstRowNumber = 1,
): ImportResult {
  const editable = spec.columns.filter((c) => c.kind !== "readonly");
  const cleaned = grid.map((r) => r.map((c) => String(c ?? "").trim()));
  let start = 0;
  let colFor: (Column<T> | undefined)[] = editable;

  const first = cleaned.find((r) => r.some(Boolean));
  if (first) {
    const mapped = first.map((cell) => editable.find((col) => cell && headerMatches(cell, col)));
    if (mapped.filter(Boolean).length >= Math.min(2, editable.length)) {
      colFor = mapped;
      start = cleaned.indexOf(first) + 1;
    }
  }

  const errors: RowError[] = [];
  const existing = spec.rows(d);
  const byId = new Map(existing.map((r, i) => [spec.identity(r), i]));
  const result = [...existing];
  const seenInFile = new Map<string, number>();
  let added = 0;
  let updated = 0;

  if (colFor === editable) {
    const missing = editable.filter((c) => c.required && !c.advanced);
    if (!first) return { data: d, added, updated, errors };
    if (first.length < missing.length) {
      errors.push({
        sheet: spec.sheet,
        row: firstRowNumber,
        message: `Couldn't find column headings, and the rows have only ${first.length} columns. Expected: ${editable.map((c) => c.header).join(", ")}.`,
      });
      return { data: d, added, updated, errors };
    }
  }

  for (let i = start; i < cleaned.length; i++) {
    const cells = cleaned[i];
    const rowNo = firstRowNumber + i;
    if (!cells.some(Boolean)) continue;

    let row: T = spec.blank(d);
    const rowErrors: string[] = [];
    const provided = new Set<string>();
    colFor.forEach((col, ci) => {
      if (!col) return;
      provided.add(col.key);
      const out = col.set(row, cells[ci] ?? "", d);
      if (typeof out === "string") rowErrors.push(out);
      else row = out;
    });
    for (const col of editable) {
      if (col.required && !provided.has(col.key)) rowErrors.push(`${col.header} column is missing.`);
    }
    const id = spec.identity(row);
    if (!rowErrors.length && seenInFile.has(id)) {
      rowErrors.push(`Same ${spec.noun} as row ${seenInFile.get(id)}.`);
    }
    if (rowErrors.length) {
      errors.push({ sheet: spec.sheet, row: rowNo, message: rowErrors.join(" ") });
      continue;
    }
    seenInFile.set(id, rowNo);
    const at = byId.get(id);
    if (at !== undefined) {
      result[at] = row;
      updated++;
    } else {
      byId.set(id, result.length);
      result.push(row);
      added++;
    }
  }
  return { data: spec.withRows(d, result), added, updated, errors };
}

/** A cell as written to Excel: codes for references, so files re-import cleanly. */
export function exportCell<T>(col: Column<T>, row: T, d: CollegeData): string {
  if (col.kind !== "select" || col.exportAs === "label") return col.get(row, d);
  const v = (row as Record<string, unknown>)[col.key];
  if (v == null || v === "") return col.options?.(d).find((o) => o.value === "")?.label ?? "";
  return String(v);
}
