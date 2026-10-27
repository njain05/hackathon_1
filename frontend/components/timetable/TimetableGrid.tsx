"use client";

import { buildRows, colourKey, subjectColours, timeRange, type Cell, type ViewKind } from "@/lib/grid";
import type { CollegeData, Entry } from "@/lib/types";

interface Props {
  data: CollegeData;
  entries: Entry[];
  view: ViewKind;
  /** Day to highlight (the "Today" view). */
  highlightDay?: string;
  /** Period to outline as happening now. */
  highlightPeriod?: number;
  /** "auto": grid on wide screens, day list on phones. "grid": always the grid (printing). */
  layout?: "auto" | "grid";
}

export function nameLookup(d: CollegeData) {
  const subjects = new Map(d.subjects.map((s) => [s.id, s]));
  const teachers = new Map(d.teachers.map((t) => [t.id, t.name || t.id]));
  const sections = new Map(d.sections.map((s) => [s.id, s.name || s.id]));
  const rooms = new Map(d.rooms.map((r) => [r.id, r.name || r.id]));
  const groups = new Map((d.elective_groups ?? []).map((g) => [g.id, g.name || g.id]));
  return {
    subject: (id: string) => subjects.get(id)?.name ?? id,
    teacher: (id: string) => teachers.get(id) ?? id,
    // An elective's "section" is its group: show the group's name.
    section: (id: string) => sections.get(id) ?? groups.get(id) ?? id,
    room: (id: string) => rooms.get(id) ?? id,
    group: (id: string) => groups.get(id) ?? id,
  };
}

/** What a cell shows besides the subject depends on whose timetable it is. */
function details(e: Entry, view: ViewKind, n: ReturnType<typeof nameLookup>): string[] {
  if (view === "section") return [n.teacher(e.teacher_id), n.room(e.room_id)];
  const who = e.batch ? `${n.section(e.section_id)}, batch ${e.batch}` : n.section(e.section_id);
  if (view === "teacher") return [who, n.room(e.room_id)];
  return [who, n.teacher(e.teacher_id)];
}

const subjectBg = (slot: number | undefined) => ({ background: `var(--color-subject-${slot ?? 1})` });

function ClassContent({ cell, view, names, colours, compact }: {
  cell: Extract<Cell, { type: "class" }>;
  view: ViewKind;
  names: ReturnType<typeof nameLookup>;
  colours: Map<string, number>;
  compact?: boolean;
}) {
  // In a section's week, an open elective is one block listing every choice.
  const group = cell.entries[0]?.elective_group;
  if (view === "section" && group && cell.entries.every((e) => e.elective_group === group)) {
    return (
      <div className="flex h-full min-w-0 flex-col rounded px-2 py-1.5" style={subjectBg(colours.get(colourKey(cell.entries[0])))}>
        <span className="flex items-baseline gap-2">
          <span className="font-bold">{names.group(group)}</span>
          <span className="rounded-sm bg-paper/80 px-1.5 text-xs font-semibold">Elective</span>
        </span>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {cell.entries.map((e, i) => (
            <li key={i} className="text-xs" title={`${names.subject(e.subject_id)}: ${names.teacher(e.teacher_id)}, ${names.room(e.room_id)}`}>
              <span className="font-semibold">{names.subject(e.subject_id)}</span>
              {/* The room is what a student needs most; the teacher is in the tooltip and for screen readers. */}
              <span className="block truncate text-ink print:whitespace-normal">
                {names.room(e.room_id)}
                <span className="sr-only">, {names.teacher(e.teacher_id)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-1">
      {cell.entries.map((e, i) => (
        <div
          key={i}
          className={`flex min-w-0 flex-1 flex-col rounded px-2 py-1.5 ${e.kind === "lab" ? "border-l-4 border-ink/25" : ""}`}
          style={subjectBg(colours.get(colourKey(e)))}
        >
          <span className="flex items-baseline gap-2">
            <span className="font-bold">{e.subject_id}</span>
            {e.kind === "lab" && (
              <span className="rounded-sm bg-paper/80 px-1.5 text-xs font-semibold">{e.batch ? `Lab ${e.batch}` : "Lab"}</span>
            )}
            {e.kind === "elective" && <span className="rounded-sm bg-paper/80 px-1.5 text-xs font-semibold">Elective</span>}
          </span>
          <span className={`text-xs ${compact ? "" : "line-clamp-2"}`}>{names.subject(e.subject_id)}</span>
          {details(e, view, names).map((t, k) => (
            <span key={k} className="truncate text-xs text-ink print:whitespace-normal">
              {t}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function TimetableGrid({ data, entries, view, highlightDay, highlightPeriod, layout = "auto" }: Props) {
  const { blocks, rows } = buildRows(data, entries);
  const names = nameLookup(data);
  const colours = subjectColours(entries, data);
  const isNow = (day: string, c: Cell) =>
    day === highlightDay &&
    highlightPeriod !== undefined &&
    c.type === "class" &&
    highlightPeriod >= c.firstPeriod &&
    highlightPeriod <= c.lastPeriod;

  const grid = (
    <div className={layout === "auto" ? "hidden md:block print:block" : ""}>
      <div className="overflow-x-auto rounded-md border border-line bg-paper print:overflow-visible print:border-ink/30">
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm print:min-w-0">
          <colgroup>
            <col className="w-24" />
            {blocks.map((b, i) => (
              <col key={i} className={b.kind === "break" ? "w-12" : ""} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-blush">
              <th scope="col" className="px-2 py-2 text-left font-semibold">Day</th>
              {blocks.map((b, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`border-l border-line px-1 py-2 text-center align-top font-semibold ${b.kind === "break" ? "bg-mint" : ""}`}
                >
                  {b.kind === "period" ? (
                    <>
                      <span className="block">Period {b.label}</span>
                      <span className="block text-xs font-normal text-ink-soft">{timeRange(b.start, b.end)}</span>
                    </>
                  ) : (
                    <span className="block text-xs leading-tight">
                      {b.label}
                      <span className="block font-normal text-ink-soft">{timeRange(b.start, b.end).replace("–", " ")}</span>
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const today = row.day === highlightDay;
              return (
                <tr key={row.day} className={`border-t border-line ${today ? "bg-sky/15" : ""}`}>
                  <th scope="row" className={`px-2 py-2 text-left align-top font-semibold ${today ? "text-navy" : ""}`}>
                    {row.day}
                    {today && <span className="block text-xs font-normal">Today</span>}
                  </th>
                  {row.cells.map((c, i) => (
                    <td
                      key={i}
                      colSpan={c.span}
                      className={`h-24 border-l border-line p-1 align-top ${c.type === "break" ? "bg-mint/50" : c.type === "off" ? "bg-cream" : ""} ${
                        isNow(row.day, c) ? "outline-3 -outline-offset-2 outline-navy print:outline-none" : ""
                      }`}
                    >
                      {c.type === "class" && <ClassContent cell={c} view={view} names={names} colours={colours} />}
                      {c.type === "off" && (
                        <span className="flex h-full items-center justify-center text-sm text-ink-soft">No classes after {timeRange(c.start, c.end).split("–")[0]}</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (layout === "grid") return grid;

  return (
    <>
      {grid}
      {/* Phones: one day at a time, as a list. */}
      <ol className="flex flex-col gap-5 md:hidden print:hidden">
        {rows.map((row) => {
          const today = row.day === highlightDay;
          return (
            <li key={row.day}>
              <h3 className={`mb-2 font-bold ${today ? "text-navy" : ""}`}>
                {row.day}
                {today && " (today)"}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {row.cells.filter((c) => c.type !== "off").map((c, i) => (
                  <li
                    key={i}
                    className={`grid grid-cols-[5.5rem_1fr] gap-3 rounded-md ${c.type === "break" ? "bg-mint/60 px-2 py-1 text-sm" : ""} ${
                      isNow(row.day, c) ? "outline-3 outline-offset-1 outline-navy" : ""
                    }`}
                  >
                    <span className={`text-sm tabular-nums ${c.type === "break" ? "" : "pt-1.5 pl-2 text-ink-soft"}`}>
                      {timeRange(c.start, c.end).split("–")[0]}
                      {c.type === "class" && <span className="block text-xs">to {timeRange(c.start, c.end).split("–")[1]}</span>}
                    </span>
                    {c.type === "class" && <ClassContent cell={c} view={view} names={names} colours={colours} compact />}
                    {c.type === "free" && <span className="py-1.5 text-sm text-ink-soft">Free</span>}
                    {c.type === "break" && <span className="font-semibold">{c.label}</span>}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Key of the subjects in this timetable, with weekly periods. */
export function SubjectKey({ data, entries, view }: { data: CollegeData; entries: Entry[]; view: ViewKind }) {
  const names = nameLookup(data);
  const colours = subjectColours(entries, data);
  const rows = [...colours.keys()].map((id) => {
    const mine = entries.filter((e) => colourKey(e) === id);
    if (id.startsWith("group:")) {
      // An open elective: its choices, and how many periods a week it meets.
      const gid = id.slice("group:".length);
      const periods = new Set(mine.map((e) => `${e.day} ${e.period}`)).size;
      const choices = [...new Set(mine.map((e) => names.subject(e.subject_id)))];
      return { id, code: names.group(gid), title: "", line: `${periods} period${periods === 1 ? "" : "s"} a week: ${choices.join(", ")}` };
    }
    const lectures = mine.filter((e) => e.kind === "lecture").length;
    const labs = mine.filter((e) => e.kind === "lab").length;
    const who = [...new Set(mine.map((e) => (view === "teacher" ? names.section(e.section_id) : names.teacher(e.teacher_id))))];
    const line = `${lectures} lecture${lectures === 1 ? "" : "s"}${labs ? ` + ${labs} lab periods` : ""} a week${who.length ? `, ${who.join(", ")}` : ""}`;
    return { id, code: id, title: names.subject(id), line };
  });
  if (!rows.length) return null;
  return (
    <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-y-0.5 print:text-xs">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-2">
          <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-sm border border-line" style={subjectBg(colours.get(r.id))} aria-hidden />
          <span>
            <span className="font-semibold">{r.code}</span> {r.title}
            <span className="block text-ink-soft">{r.line}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
