// Timetable downloads, built in the browser:
// - an Excel workbook with every section's, teacher's and room's week;
// - an iCalendar (.ics) file that phones and Google/Outlook calendars import.
// The builders are pure (data in, workbook or text out); only the download
// helpers touch the page. Nothing college-specific: days, periods and breaks
// all come from the data.

import * as XLSX from "xlsx";
import { buildRows, entriesFor, timeRange, type Cell, type ViewKind } from "./grid";
import { batchOf, codeAndName, lookup, plural } from "./reports";
import type { CollegeData, Entry, SolveResult } from "./types";

type Names = ReturnType<typeof lookup>;
type ClassCell = Extract<Cell, { type: "class" }>;

const KIND_TAG: Record<Entry["kind"], string> = { lecture: "", lab: " (Lab)", elective: " (Elective)" };

const unique = <T,>(xs: T[]) => [...new Set(xs)];

/** "CS201 Data Structures", or just the code when there is no separate name. */
function subjectLabel(e: Entry, n: Names): string {
  const name = n.subject(e.subject_id);
  return name && name !== e.subject_id ? `${e.subject_id} ${name}` : e.subject_id;
}

/** The section(s) a class is for. An elective names its group and member sections. */
function sectionText(e: Entry, n: Names): string {
  if (e.kind === "elective" && e.elective_sections?.length)
    return `${n.group(e.section_id)} (${e.elective_sections.join(", ")})`;
  return codeAndName(e.section_id, n.section(e.section_id));
}

/** True when a section's cell is one open elective (its parallel choices). */
function electiveGroupOf(entries: Entry[], view: ViewKind): string | null {
  const group = entries[0]?.elective_group;
  return view === "section" && group && entries.every((e) => e.elective_group === group) ? group : null;
}

/** A file name from any text: "Sample Institute" → "sample-institute". */
export function fileSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "timetable"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download after click() returns; free the memory a little later.
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// =====================================================================
// Excel
// =====================================================================

/** "CS201 Data Structures (Lab) / Dr. Harpreet Kaur / Computer Lab 1" (who and where depend on the view). */
export function cellText(entries: Entry[], view: ViewKind, n: Names): string {
  const group = electiveGroupOf(entries, view);
  if (group)
    return `${n.group(group)} (Elective), choose one: ${entries
      .map((e) => `${subjectLabel(e, n)} / ${n.teacher(e.teacher_id)} / ${n.room(e.room_id)}`)
      .join("; ")}`;
  return entries
    .map((e) => {
      const batch = batchOf(e);
      const who =
        view === "section"
          ? [n.teacher(e.teacher_id), n.room(e.room_id)]
          : view === "teacher"
            ? [sectionText(e, n), n.room(e.room_id)]
            : [sectionText(e, n), n.teacher(e.teacher_id)];
      return [`${batch ? `Batch ${batch}: ` : ""}${subjectLabel(e, n)}${KIND_TAG[e.kind] ?? ""}`, ...who].join(" / ");
    })
    .join("; ");
}

const BAD_SHEET_CHARS = /[\\/?*[\]:]/g;
const MAX_SHEET_NAME = 31;

/**
 * A name Excel accepts: at most 31 characters, none of \ / ? * [ ] :, no
 * apostrophe at either end, not "History", and unique (Excel ignores case).
 * `taken` holds the lower-cased names already used and is updated.
 */
export function sheetName(raw: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/^'+|'+$/g, "").trim();
  let base = clean(raw.replace(BAD_SHEET_CHARS, "-")) || "Sheet";
  if (base.toLowerCase() === "history") base = "History 1";
  base = clean(base.slice(0, MAX_SHEET_NAME)) || "Sheet";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = clean(base.slice(0, MAX_SHEET_NAME - suffix.length)) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Distinct (day, period) slots in a list of entries. */
const slotCount = (entries: Entry[]) => new Set(entries.map((e) => `${e.day}|${e.period}`)).size;

/** Subject key under a grid: code, name, weekly periods and with whom. */
function keyRows(entries: Entry[], view: ViewKind, n: Names): string[][] {
  const rows: string[][] = [];
  const groups = unique(entries.filter((e) => e.kind === "elective" && e.elective_group).map((e) => e.elective_group as string));
  for (const id of unique(entries.map((e) => e.subject_id))) {
    const mine = entries.filter((e) => e.subject_id === id && !(view === "section" && e.kind === "elective"));
    if (!mine.length) continue;
    const lectures = slotCount(mine.filter((e) => e.kind === "lecture"));
    const labs = slotCount(mine.filter((e) => e.kind === "lab"));
    const electives = slotCount(mine.filter((e) => e.kind === "elective"));
    const parts = [
      lectures ? plural(lectures, "lecture") : "",
      labs ? plural(labs, "lab period") : "",
      electives ? plural(electives, "elective period") : "",
    ].filter(Boolean);
    const who = unique(mine.map((e) => (view === "teacher" ? sectionText(e, n) : n.teacher(e.teacher_id))));
    rows.push([id, n.subject(id), parts.join(", "), who.join(", ")]);
  }
  if (view === "section")
    for (const g of groups) {
      const mine = entries.filter((e) => e.elective_group === g);
      const choices = unique(mine.map((e) => `${subjectLabel(e, n)} (${n.teacher(e.teacher_id)})`));
      rows.push([g, n.group(g), `${plural(slotCount(mine), "period")} (open elective)`, `Choices: ${choices.join(", ")}`]);
    }
  return rows;
}

/** One timetable as a sheet: days down, periods and breaks across with clock times. */
function timetableSheet(d: CollegeData, entries: Entry[], view: ViewKind, title: string, n: Names): XLSX.WorkSheet {
  const { blocks, rows } = buildRows(d, entries);
  const header = [
    "Day",
    ...blocks.map((b) => (b.kind === "period" ? `Period ${b.label} (${timeRange(b.start, b.end)})` : `${b.label} (${timeRange(b.start, b.end)})`)),
  ];
  const aoa: string[][] = [[title], [d.name], [], header];
  const merges: XLSX.Range[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, blocks.length) } }];
  for (const row of rows) {
    const r = aoa.length;
    const line: string[] = [row.day];
    for (const c of row.cells) {
      const col = line.length;
      if (c.type === "class") {
        line.push(cellText(c.entries, view, n));
        // A lab over several periods (and a break it runs across) is one merged cell.
        for (let k = 1; k < c.span; k++) line.push("");
        if (c.span > 1) merges.push({ s: { r, c: col }, e: { r, c: col + c.span - 1 } });
      } else line.push(c.type === "break" ? c.label : "");
    }
    aoa.push(line);
  }
  const key = keyRows(entries, view, n);
  if (key.length) aoa.push([], ["Key"], ["Code", "Subject", "Each week", view === "teacher" ? "Sections" : "Taught by"], ...key);
  if (!entries.length) aoa.push([], ["No classes are scheduled here."]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 14 }, ...blocks.map((b) => ({ wch: b.kind === "break" ? 14 : 34 }))];
  return ws;
}

interface SheetPlan {
  view: ViewKind;
  id: string;
  label: string;
  sheet: string;
  entries: Entry[];
}

/** Every timetable worth a sheet: sections, teachers, then rooms that can hold classes. */
function plan(d: CollegeData, entries: Entry[]): SheetPlan[] {
  const taken = new Set<string>(["contents"]);
  const uses = new Map(d.room_types.map((t) => [t.id, t.use]));
  const n = lookup(d);
  const items: Omit<SheetPlan, "sheet" | "entries">[] = [
    ...d.sections.map((s) => ({ view: "section" as const, id: s.id, label: codeAndName(s.id, s.name) })),
    ...d.teachers.map((t) => ({ view: "teacher" as const, id: t.id, label: `${t.name || t.id} (${t.id})` })),
    ...d.rooms
      .filter((r) => uses.get(r.type) !== "event") // seminar halls and auditoriums never hold classes
      .map((r) => ({ view: "room" as const, id: r.id, label: codeAndName(r.id, n.room(r.id)) })),
  ];
  const prefix: Record<ViewKind, string> = { section: "Section", teacher: "Teacher", room: "Room" };
  return items.map((it) => ({
    ...it,
    sheet: sheetName(`${prefix[it.view]} ${it.id}`, taken),
    entries: entriesFor(entries, it.view, it.id), // a section's week includes its open electives
  }));
}

/** The whole timetable as a workbook: a contents sheet, then one sheet per section, teacher and room. */
export function timetableWorkbook(d: CollegeData, result: SolveResult): XLSX.WorkBook {
  const n = lookup(d);
  const sheets = plan(d, result.entries);
  const wb = XLSX.utils.book_new();
  const nouns: Record<ViewKind, string> = { section: "Section", teacher: "Teacher", room: "Room" };
  const contents = XLSX.utils.aoa_to_sheet([
    [`Timetables: ${d.name}`],
    [`${d.settings.days.length} days, ${d.settings.periods_per_day} periods a day. One sheet for each section, teacher and room.`],
    [],
    ["Sheet", "Timetable of", "Periods a week"],
    ...sheets.map((s) => [s.sheet, `${nouns[s.view]}: ${s.label}`, slotCount(s.entries)]),
  ]);
  contents["!cols"] = [{ wch: 24 }, { wch: 48 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, contents, "Contents");
  for (const s of sheets)
    XLSX.utils.book_append_sheet(wb, timetableSheet(d, s.entries, s.view, `${nouns[s.view]}: ${s.label}`, n), s.sheet);
  return wb;
}

export function downloadTimetableExcel(d: CollegeData, result: SolveResult, filename = `${fileSlug(d.name)}-timetables.xlsx`): void {
  XLSX.writeFile(timetableWorkbook(d, result), filename);
}

// =====================================================================
// Calendar (.ics, RFC 5545)
// =====================================================================

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** 0 = Sunday … 6 = Saturday, from an English day name ("Monday", "Tue"); null if it isn't one. */
export function weekdayIndex(day: string): number | null {
  const i = WEEKDAYS.indexOf(day.trim().slice(0, 3).toLowerCase());
  return i < 0 ? null : i;
}

/** The college's days that can't be placed on a calendar (not weekday names, e.g. "Day 1"). */
export const unplaceableDays = (d: CollegeData) => d.settings.days.filter((day) => weekdayIndex(day) === null);

const pad = (n: number) => String(n).padStart(2, "0");

/** Floating local time, e.g. 20261102T091000 (no time zone: "whatever the phone's clock says"). */
function icsLocal(date: Date, minutes: number): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

function icsUtc(t: Date): string {
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

/** The first date on or after `from` that falls on this weekday. */
function firstOn(from: Date, weekday: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d;
}

/** TEXT value escaping: backslash, semicolon, comma and newlines. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const utf8 = new TextEncoder();

/** Fold a content line at 75 octets (continuation lines start with a space), never inside a character. */
export function foldLine(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = utf8.encode(ch).length;
    if (bytes + b > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // the leading space takes one octet
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** Short stable hash (FNV-1a plus a second, differently seeded run), so a class keeps its UID across downloads. */
function stableHash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  b = Math.imul(b ^ (b >>> 13), 0x5bd1e995);
  b ^= b >>> 15;
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

function describeEvent(c: ClassCell, view: ViewKind, n: Names, d: CollegeData, label: string) {
  const es = c.entries;
  const periods = c.firstPeriod === c.lastPeriod ? `Period ${c.firstPeriod}` : `Periods ${c.firstPeriod}–${c.lastPeriod}`;
  const footer = `${periods}, ${timeRange(c.start, c.end)}. From the ${d.name} timetable for ${label}.`;
  const location = unique(es.map((e) => n.room(e.room_id))).join(", ");

  const group = electiveGroupOf(es, view);
  if (group)
    return {
      summary: `${n.group(group)} (Elective)`,
      location,
      description: [
        "Open elective: go to the class you chose.",
        ...es.map((e) => `${subjectLabel(e, n)}: ${n.teacher(e.teacher_id)}, ${n.room(e.room_id)}`),
        "",
        footer,
      ].join("\n"),
    };

  const who = (e: Entry) =>
    view === "section"
      ? `Teacher: ${n.teacher(e.teacher_id)}`
      : view === "teacher"
        ? `Section: ${sectionText(e, n)}`
        : `Section: ${sectionText(e, n)}. Teacher: ${n.teacher(e.teacher_id)}`;
  const titles = unique(es.map((e) => subjectLabel(e, n)));
  const kinds = unique(es.map((e) => e.kind));
  // Teachers and rooms see whose class it is right in the title.
  const whose = view === "section" ? [] : unique(es.map((e) => (e.kind === "elective" ? n.group(e.section_id) : e.section_id)));
  const summary = `${titles.join(" / ")}${kinds.length === 1 ? KIND_TAG[kinds[0]] ?? "" : ""}${whose.length ? `, ${whose.join(", ")}` : ""}`;
  const lines =
    es.length === 1
      ? [`${batchOf(es[0]) ? `Batch ${batchOf(es[0])}. ` : ""}${who(es[0])}`]
      : es.map((e) => {
          const head = [batchOf(e) ? `Batch ${batchOf(e)}` : "", titles.length > 1 ? subjectLabel(e, n) : ""].filter(Boolean).join(", ");
          return `${head ? `${head}: ` : ""}${who(e)}, ${n.room(e.room_id)}`;
        });
  return { summary, location, description: [...lines, "", footer].join("\n") };
}

export interface IcsOptions {
  /** Classes start from the first matching weekday on or after this date. */
  from: Date;
  /** How many weeks each class repeats. */
  weeks: number;
  /** Creation time stamp (DTSTAMP); defaults to now. */
  now?: Date;
}

/**
 * An iCalendar file with one weekly-repeating event per class: a lab over
 * several periods is one event. Times are floating local times (no time zone).
 * Days that aren't weekday names ("Day 1") are left out; see unplaceableDays().
 */
export function icsForEntries(d: CollegeData, entries: Entry[], view: ViewKind, label: string, options: IcsOptions): string {
  const n = lookup(d);
  const weeks = Math.max(1, Math.min(520, Math.round(options.weeks) || 1));
  const stamp = icsUtc(options.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//College Timetable//Timetable export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`${label} timetable`)}`,
  ];
  const { rows } = buildRows(d, entries);
  for (const row of rows) {
    const weekday = weekdayIndex(row.day);
    if (weekday === null) continue;
    const date = firstOn(options.from, weekday);
    for (const c of row.cells) {
      if (c.type !== "class") continue;
      const ev = describeEvent(c, view, n, d, label);
      const what = c.entries
        .map((e) => [e.subject_id, e.section_id, e.teacher_id, e.room_id, e.kind, batchOf(e) ?? ""].join("/"))
        .sort()
        .join("+");
      const uid = `${stableHash([d.name, view, label, row.day, c.firstPeriod, what].join("|"))}-${WEEKDAYS[weekday]}-p${c.firstPeriod}@college-timetable`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsLocal(date, c.start)}`,
        `DTEND:${icsLocal(date, c.end)}`,
        `RRULE:FREQ=WEEKLY;COUNT=${weeks}`,
        `SUMMARY:${icsEscape(ev.summary)}`,
        ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
        `DESCRIPTION:${icsEscape(ev.description)}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, text: string): void {
  downloadBlob(new Blob([text], { type: "text/calendar;charset=utf-8" }), filename.endsWith(".ics") ? filename : `${filename}.ics`);
}
