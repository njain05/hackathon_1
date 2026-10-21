// Turns solver entries into rows for the timetable grid and the day list.
// Pure functions: no React, nothing college-specific.

import { dayBlocks, formatTime, type TimeBlock } from "./periods";
import type { CollegeData, Entry } from "./types";

export type ViewKind = "section" | "teacher" | "room";

export const VIEW_FIELD: Record<ViewKind, keyof Entry> = {
  section: "section_id",
  teacher: "teacher_id",
  room: "room_id",
};

/** A cell in one day's row: a class (possibly spanning several periods), a break, or free. */
export type Cell =
  | { type: "class"; entries: Entry[]; firstPeriod: number; lastPeriod: number; span: number; start: number; end: number }
  | { type: "break"; label: string; start: number; end: number; span: 1 }
  | { type: "free"; period: number; start: number; end: number; span: 1 };

export interface Row {
  day: string;
  cells: Cell[];
}

const entryKey = (e: Entry) => `${e.subject_id}|${e.section_id}|${e.teacher_id}|${e.room_id}|${e.kind}`;
const cellKey = (es: Entry[]) => es.map(entryKey).sort().join("+");

/** Entries for one section / teacher / room. */
export function entriesFor(entries: Entry[], view: ViewKind, id: string): Entry[] {
  const field = VIEW_FIELD[view];
  return entries.filter((e) => e[field] === id);
}

/**
 * One row per working day. Columns follow the real day: periods and breaks
 * in order. A lab is merged into one cell across its periods, including a
 * break it is allowed to run across.
 */
export function buildRows(d: CollegeData, entries: Entry[]): { blocks: TimeBlock[]; rows: Row[] } {
  const blocks = dayBlocks(d.settings);
  const subjects = new Map(d.subjects.map((x) => [x.id, x]));
  const breakAfter = new Map(d.settings.breaks.map((b) => [b.after_period, b]));
  const rows: Row[] = d.settings.days.map((day) => {
    const at = new Map<number, Entry[]>();
    for (const e of entries) {
      if (e.day !== day) continue;
      at.set(e.period, [...(at.get(e.period) ?? []), e]);
    }
    const cells: Cell[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === "break") {
        cells.push({ type: "break", label: b.label, start: b.start, end: b.end, span: 1 });
        continue;
      }
      const p = Number(b.label);
      const here = at.get(p);
      if (!here?.length) {
        cells.push({ type: "free", period: p, start: b.start, end: b.end, span: 1 });
        continue;
      }
      // Extend a lab block over following periods (and breaks it runs across).
      let span = 1;
      let last = p;
      let end = b.end;
      if (here.every((e) => e.kind === "lab")) {
        const block = Math.max(...here.map((e) => subjects.get(e.subject_id)?.lab_block_length ?? 1));
        let periods = 1;
        let j = i + 1;
        let pending = 0; // break columns we'd swallow if the lab continues after them
        while (j < blocks.length && periods < block) {
          const nb = blocks[j];
          if (nb.kind === "break") {
            // Only a break labs may run across can sit inside a lab block.
            if (!breakAfter.get(Number(blocks[j - 1 - pending].label))?.labs_continue) break;
            pending++;
            j++;
            continue;
          }
          const next = at.get(Number(nb.label));
          if (!next?.length || cellKey(next) !== cellKey(here)) break;
          span += pending + 1;
          pending = 0;
          periods++;
          last = Number(nb.label);
          end = nb.end;
          j++;
        }
        i += span - 1;
      }
      cells.push({ type: "class", entries: here, firstPeriod: p, lastPeriod: last, span, start: b.start, end });
    }
    return { day, cells };
  });
  return { blocks, rows };
}

export function timeRange(start: number, end: number): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** Number of subject colour tokens defined in globals.css (--color-subject-1 … N). */
export const SUBJECT_COLOURS = 12;

/** Colour slot per subject, in order of first appearance, so one view never repeats a colour early. */
export function subjectColours(entries: Entry[], d: CollegeData): Map<string, number> {
  const order = new Map(d.subjects.map((s, i) => [s.id, i]));
  const ids = [...new Set(entries.map((e) => e.subject_id))].sort(
    (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
  return new Map(ids.map((id, i) => [id, (i % SUBJECT_COLOURS) + 1]));
}
