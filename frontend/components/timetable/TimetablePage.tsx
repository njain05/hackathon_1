"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import AdminAsk from "@/components/ask/AdminAsk";
import PublishBar from "@/components/share/PublishBar";
import { useAccess } from "@/lib/access";
import { toApi } from "@/lib/api";
import { entriesFor, type ViewKind } from "@/lib/grid";
import { useLocal } from "@/lib/local";
import { useStaffTimetable } from "@/lib/staffTimetable";
import type { CollegeData, Entry } from "@/lib/types";
import ExportButtons from "./ExportButtons";
import { CheckSummary } from "./QualityPanel";
import TimetableGrid, { SubjectKey } from "./TimetableGrid";
import PageLoading from "@/components/ui/PageLoading";

const VIEWS: { id: ViewKind; label: string; noun: string }[] = [
  { id: "section", label: "By section", noun: "Section" },
  { id: "teacher", label: "By teacher", noun: "Teacher" },
  { id: "room", label: "By room", noun: "Room" },
];

/** "CSE-3A – CSE 3rd Sem A", but just "Room C-101" when the name already contains the code. */
const codeAndName = (id: string, name: string) => (!name || name.includes(id) ? name || id : `${id} – ${name}`);

export function choices(d: CollegeData, view: ViewKind): { id: string; label: string }[] {
  if (view === "section") return d.sections.map((s) => ({ id: s.id, label: codeAndName(s.id, s.name) }));
  if (view === "teacher") return d.teachers.map((t) => ({ id: t.id, label: `${t.name} (${t.id})` }));
  const uses = new Map(d.room_types.map((t) => [t.id, t.use]));
  return d.rooms
    .filter((r) => uses.get(r.type) !== "event") // halls and auditoriums never hold classes
    .map((r) => ({ id: r.id, label: codeAndName(r.id, r.name) }));
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">{title}</h1>
      <div className="text-lg text-ink-soft">{children}</div>
      <div>
        <Link href="/setup" className="btn-primary">
          Go to setup
        </Link>
      </div>
    </main>
  );
}

function PrintableTimetable({ data, entries, view, id, label }: {
  data: CollegeData;
  entries: Entry[];
  view: ViewKind;
  id: string;
  label: string;
}) {
  const mine = entriesFor(entries, view, id);
  return (
    <section className="print-page flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold">{label}</h2>
        <span className="text-sm text-ink-soft">{data.name}</span>
      </header>
      <TimetableGrid data={data} entries={mine} view={view} layout="grid" />
      <SubjectKey data={data} entries={mine} view={view} />
    </section>
  );
}

/** JSON with sorted keys, so two copies of the same setup compare equal. */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}

export default function TimetablePage() {
  const { stored } = useStaffTimetable();
  const access = useAccess();
  const draftRaw = useLocal("timetable.setup.v1");
  // Has the setup changed since this timetable was generated?
  const stale = useMemo(() => {
    if (!stored || !draftRaw) return false;
    try {
      return stableJson(toApi(JSON.parse(draftRaw) as CollegeData)) !== stableJson(toApi(stored.data));
    } catch {
      return false;
    }
  }, [stored, draftRaw]);
  const [view, setView] = useState<ViewKind>("section");
  const [picked, setPicked] = useState<Partial<Record<ViewKind, string>>>({});
  const [printAll, setPrintAll] = useState(false);

  if (stored === undefined) return <PageLoading />;
  if (stored === null)
    return (
      <>
        <AppNav />
        {access && !access.staff && access.viewing ? (
          <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
            <h1 className="text-3xl font-bold">Looking for your classes?</h1>
            <p className="text-lg text-ink-soft">This page is where the timetable in-charge reviews every timetable.</p>
            <div>
              <Link href="/my" className="btn-primary !px-5 !py-3 !text-base">
                Open my timetable
              </Link>
            </div>
          </main>
        ) : (
          <EmptyState title="No timetable yet">
            Enter your college in the setup, then press Generate timetable on the last step. It will appear here.
          </EmptyState>
        )}
      </>
    );

  const { data, result, at } = stored;
  const options = choices(data, view);
  const id = picked[view] && options.some((o) => o.id === picked[view]) ? picked[view]! : options[0]?.id ?? "";
  const label = options.find((o) => o.id === id)?.label ?? id;
  const mine = entriesFor(result.entries, view, id);
  const noun = VIEWS.find((v) => v.id === view)!.noun;

  const print = (all: boolean) => {
    setPrintAll(all);
    // Let React render the print copy before the print dialog opens.
    setTimeout(() => window.print(), 50);
  };

  return (
    <>
      <AppNav collegeName={data.name} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 print:hidden">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Timetables</h1>
            <p className="text-ink-soft">
              Generated {new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} for{" "}
              {data.settings.days.length} days, {data.settings.periods_per_day} periods a day.{" "}
              <Link href="/setup" className="font-semibold text-navy underline">
                Change the setup
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-quiet" onClick={() => print(false)}>
              Print this timetable
            </button>
            <button type="button" className="btn-quiet" onClick={() => print(true)}>
              Print all {noun.toLowerCase()}s
            </button>
            <ExportButtons data={data} result={result} />
          </div>
        </div>

        {stale && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-blush px-4 py-3">
            <p>
              <span className="font-semibold">Your setup has changed since this timetable was generated.</span>{" "}
              Generate it again so the changes are included before you publish.
            </p>
            <Link href="/setup" className="btn-quiet">
              Go to setup
            </Link>
          </div>
        )}
        <PublishBar stored={stored} />
        <CheckSummary result={result} />

        <div className="flex flex-wrap items-end gap-4">
          <div role="group" aria-label="Whose timetable" className="flex rounded-md border border-line bg-paper p-1">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
                className={`rounded px-4 py-2 text-sm font-semibold ${view === v.id ? "bg-sky/50" : "hover:bg-blush"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="field-label">{noun}</span>
            <select value={id} onChange={(e) => setPicked({ ...picked, [view]: e.target.value })} className="field min-w-64">
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section aria-label={label} className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">{label}</h2>
          {mine.length === 0 ? (
            <p className="text-ink-soft">No classes are scheduled for this {noun.toLowerCase()}.</p>
          ) : (
            <TimetableGrid data={data} entries={mine} view={view} />
          )}
          <SubjectKey data={data} entries={mine} view={view} />
        </section>

        <AdminAsk data={data} result={result} />
      </main>

      {/* Print copy: just the timetable(s), one per page. */}
      <div className="hidden flex-col gap-0 print:flex">
        {(printAll ? options : options.filter((o) => o.id === id)).map((o) => (
          <PrintableTimetable key={o.id} data={data} entries={result.entries} view={view} id={o.id} label={`${noun}: ${o.label}`} />
        ))}
      </div>
    </>
  );
}
