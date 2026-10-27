"use client";

import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import AskBox from "@/components/ask/AskBox";
import { ChangesChecking, ChangesFeed, ChangesUnknown, useMyDay } from "@/components/changes/MyChanges";
import { CollegeCodeForm, OpenCollegePage } from "@/components/share/OpenCollege";
import { localNow } from "@/lib/ask";
import { useAccount } from "@/lib/accounts";
import { isoDate, nextDateFor } from "@/lib/changes";
import { setViewedCollege, useViewerTimetable } from "@/lib/cloud";
import { buildRows, entriesFor, timeRange, type Cell, type ViewKind } from "@/lib/grid";
import { useLocal, writeLocal } from "@/lib/local";
import { formatTime } from "@/lib/periods";
import { useStoredTimetable } from "@/lib/result";
import type { CollegeData, Entry } from "@/lib/types";
import CalendarExport from "./CalendarExport";
import { choices } from "./TimetablePage";
import TimetableGrid, { nameLookup, SubjectKey } from "./TimetableGrid";
import PageLoading from "@/components/ui/PageLoading";

const ME_KEY = "timetable.me.v1";

interface Me {
  role: "section" | "teacher";
  id: string;
  /** The choice for each role, so switching student ⇄ teacher keeps both. */
  ids?: Partial<Record<"section" | "teacher", string>>;
}

interface Clock {
  day: string; // weekday name, e.g. "Wednesday"
  minutes: number; // minutes since midnight
  demo: boolean;
}

/**
 * The current day and time, ticking every 30 s. For demos, `?now=Monday 10:15`
 * in the address bar pretends it is that day and time.
 */
function useClock(): Clock | null {
  const [clock, setClock] = useState<Clock | null>(null);
  useEffect(() => {
    const tick = () => {
      const override = new URLSearchParams(window.location.search).get("now");
      const m = override?.match(/^\s*([A-Za-z]+)\s+(\d{1,2}):(\d{2})\s*$/);
      if (m) {
        setClock({ day: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), minutes: Number(m[2]) * 60 + Number(m[3]), demo: true });
        return;
      }
      const d = new Date();
      setClock({ day: d.toLocaleDateString("en-US", { weekday: "long" }), minutes: d.getHours() * 60 + d.getMinutes(), demo: false });
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return clock;
}

type ClassCell = Extract<Cell, { type: "class" }>;

function inMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function ClassCard({ title, cell, data, role, note }: { title: string; cell: ClassCell; data: CollegeData; role: ViewKind; note: string }) {
  const n = nameLookup(data);
  const e: Entry = cell.entries[0];
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-paper p-4">
      <span className="text-sm font-semibold text-ink-soft">{title}</span>
      <span className="text-xl font-bold">
        {n.subject(e.subject_id)}
        {e.kind === "lab" && <span className="ml-2 rounded-sm bg-mint px-1.5 align-middle text-sm">Lab</span>}
      </span>
      <span>
        {role === "section" ? n.teacher(e.teacher_id) : n.section(e.section_id)}, {n.room(e.room_id)}
      </span>
      <span className="text-sm text-ink-soft">
        {timeRange(cell.start, cell.end)}, {note}
      </span>
    </div>
  );
}

function TodayPanel({ data, entries, role, clock }: { data: CollegeData; entries: Entry[]; role: ViewKind; clock: Clock }) {
  const { rows } = buildRows(data, entries);
  const days = data.settings.days;
  const todayRow = rows.find((r) => r.day === clock.day);
  const now = clock.minutes;

  if (!todayRow) {
    // Not a working day: point to the next one.
    const order = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const start = order.indexOf(clock.day);
    const next = start < 0 ? days[0] : [...Array(7)].map((_, i) => order[(start + i + 1) % 7]).find((d) => days.includes(d));
    const first = rows.find((r) => r.day === next)?.cells.find((c): c is ClassCell => c.type === "class");
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-line bg-mint/60 p-4">
          <span className="text-sm font-semibold text-ink-soft">Today, {clock.day}</span>
          <p className="text-xl font-bold">No classes today</p>
        </div>
        {first && <ClassCard title={`First class on ${next}`} cell={first} data={data} role={role} note={`starts at ${formatTime(first.start)}`} />}
      </div>
    );
  }

  const cells = todayRow.cells;
  const current = cells.find((c) => c.start <= now && now < c.end);
  const next = cells.find((c): c is ClassCell => c.type === "class" && c.start >= now && c !== current);
  const classesToday = cells.filter((c) => c.type === "class").length;

  let nowBox: React.ReactNode;
  if (current?.type === "class") {
    nowBox = <ClassCard title="Now" cell={current} data={data} role={role} note={`ends in ${inMinutes(current.end - now)}`} />;
  } else {
    // Your first and last class today (not the first period of the college day).
    const classes = cells.filter((c): c is ClassCell => c.type === "class");
    const first = classes[0];
    const last = classes[classes.length - 1];
    const text =
      classesToday === 0
        ? "No classes today"
        : now < first.start
          ? `Your first class is at ${formatTime(first.start)}`
          : now >= last.end || !next
            ? "Done for today"
            : current?.type === "break"
              ? `${current.label} until ${formatTime(current.end)}`
              : "Free period";
    nowBox = (
      <div className="rounded-md border border-line bg-mint/60 p-4">
        <span className="text-sm font-semibold text-ink-soft">Now</span>
        <p className="text-xl font-bold">{text}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {nowBox}
      {next ? (
        <ClassCard title="Next" cell={next} data={data} role={role} note={`starts in ${inMinutes(next.start - now)}`} />
      ) : (
        <div className="rounded-md border border-line bg-paper p-4">
          <span className="text-sm font-semibold text-ink-soft">Next</span>
          <p className="text-xl font-bold">Nothing more today</p>
        </div>
      )}
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function MyTimetable() {
  const local = useStoredTimetable();
  const { state: source, refresh } = useViewerTimetable(local);
  const [changing, setChanging] = useState(false);
  const [picking, setPicking] = useState(false); // show the full "I am a…" picker again
  const rawMe = useLocal(ME_KEY);
  const account = useAccount();
  // A signed-in student sees only their own section: no switching role, section or college.
  const student = account?.role === "student" ? account : null;
  const clock = useClock();
  // Today's real timetable (with leave cover, cancellations, extra classes) from the server.
  // With ?now=Monday 10:15, "today" is the next Monday.
  const dateIso = clock ? (clock.demo ? nextDateFor(clock.day) : isoDate(new Date())) : null;
  const myDay = useMyDay(source.kind === "published" ? source.college.code : null, dateIso);
  const me = useMemo<Me | null>(() => {
    try {
      return rawMe ? (JSON.parse(rawMe) as Me) : null;
    } catch {
      return null;
    }
  }, [rawMe]);
  const [role, setRole] = useState<Me["role"] | null>(null);

  // Wait for the clock too (a moment after opening), so Today never pushes the week down.
  if (source.kind === "loading" || rawMe === undefined || account === undefined || !clock) return <PageLoading />;
  if (source.kind === "none")
    return (
      <>
        <AppNav />
        <OpenCollegePage error={source.error} />
      </>
    );

  const { data, result } = source.stored;
  const activeRole = student ? "section" : (role ?? me?.role ?? "section");
  const options = choices(data, activeRole);
  const remembered = student?.section_id ?? me?.ids?.[activeRole] ?? (me?.role === activeRole ? me.id : "");
  const myId = remembered && options.some((o) => o.id === remembered) ? remembered : "";
  const mine = myId ? entriesFor(result.entries, activeRole, myId) : [];
  const myLabel = options.find((o) => o.id === myId)?.label;
  // The Today card uses the day as it actually is; the week grid stays as published.
  const actualToday = myDay.day && clock && myDay.day.day === clock.day ? entriesFor(myDay.day.entries, activeRole, myId) : null;
  const todayEntries = actualToday && clock ? [...mine.filter((e) => e.day !== clock.day), ...actualToday] : mine;
  const classesToday = mine.some((e) => e.day === clock.day);
  const periodNow =
    clock &&
    buildRows(data, mine)
      .blocks.filter((b) => b.kind === "period")
      .find((b) => b.start <= clock.minutes && clock.minutes < b.end)?.label;

  return (
    <>
      <AppNav collegeName={source.kind === "published" ? source.college.name : data.name} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold sm:text-3xl">{myLabel ? `My timetable: ${myLabel}` : "My timetable"}</h1>
          {source.kind === "published" ? (
            <p className="text-ink-soft">
              {source.college.name}, college code <span className="font-semibold text-ink">{source.college.code}</span>.
              Published {when(source.stored.at)}.{" "}
              {!student && (
                <button type="button" className="font-semibold text-navy underline print:hidden" onClick={() => setChanging(true)}>
                  Change college
                </button>
              )}
            </p>
          ) : (
            <p className="text-ink-soft print:hidden">
              This is the timetable generated in this browser. Students and teachers see it once it is published.{" "}
              <button type="button" className="font-semibold text-navy underline" onClick={() => setChanging(true)}>
                Open a college by code
              </button>
            </p>
          )}
          {source.kind === "published" && source.stale && (
            <p role="status" className="flex flex-wrap items-center gap-3 rounded-md bg-blush px-3 py-2 print:hidden">
              <span>
                <span className="font-semibold">Showing the copy saved on this phone</span> (downloaded {when(source.fetchedAt)}).{" "}
                {source.error}
              </span>
              <button type="button" className="btn-quiet !py-1" onClick={refresh}>
                Refresh
              </button>
            </p>
          )}
          {clock?.demo && (
            <p className="text-sm text-ink-soft">
              Showing as if it were {clock.day} {formatTime(clock.minutes)} (from the address bar).
            </p>
          )}
        </div>

        {changing && (
          <section className="rounded-md border border-line bg-paper p-4 print:hidden" aria-label="Open another college">
            <CollegeCodeForm onCancel={() => setChanging(false)} />
            {source.kind === "published" && (
              <button
                type="button"
                className="mt-3 text-sm font-semibold text-navy underline"
                onClick={() => {
                  setViewedCollege(null);
                  setChanging(false);
                }}
              >
                Forget {source.college.name} on this device
              </button>
            )}
          </section>
        )}

        {myId && !picking ? (
          // Already chosen: one line, so Today and the week come first.
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <p>
              <span className="text-ink-soft">{activeRole === "section" ? "Your section:" : "Your name:"}</span>{" "}
              <span className="font-semibold">{myLabel ?? myId}</span>
            </p>
            {!student && (
              <button type="button" className="font-semibold text-navy underline" onClick={() => setPicking(true)}>
                Change
              </button>
            )}
            <button type="button" className="btn-quiet ml-auto" onClick={() => window.print()}>
              Print my timetable
            </button>
          </div>
        ) : student ? (
          <p role="status" className="rounded-md border border-line bg-paper p-4">
            Your section ({student.section_id ?? "not set"}) isn’t in the published timetable yet. Ask your college’s Dean’s
            office.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            <div role="group" aria-label="I am a" className="flex rounded-md border border-line bg-paper p-1">
              {(["section", "teacher"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={activeRole === r}
                  // Only looking: the role is remembered once a section or name is chosen.
                  onClick={() => setRole(r)}
                  className={`rounded px-4 py-2 text-sm font-semibold ${activeRole === r ? "bg-sky/50" : "hover:bg-blush"}`}
                >
                  {r === "section" ? "I'm a student" : "I'm a teacher"}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className="field-label">{activeRole === "section" ? "Your section" : "Your name"}</span>
              <select
                value={myId}
                onChange={(e) => {
                  // Each role keeps its own section or name, so switching back finds it again.
                  const ids = { ...(me ? { [me.role]: me.id || undefined } : {}), ...me?.ids, [activeRole]: e.target.value || undefined };
                  writeLocal(ME_KEY, JSON.stringify({ role: activeRole, id: e.target.value, ids }));
                  setPicking(false);
                }}
                className="field min-w-64"
              >
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {myId && (
              <button type="button" className="btn-quiet" onClick={() => setPicking(false)}>
                Done
              </button>
            )}
          </div>
        )}

        {!myId ? (
          !student && <p className="text-lg text-ink-soft">
            Choose your {activeRole === "section" ? "section" : "name"} to see your week. This browser will remember it.
          </p>
        ) : (
          <>
            {source.kind === "published" &&
              dateIso &&
              (myDay.day ? (
                <ChangesFeed data={data} me={{ role: activeRole, id: myId }} date={dateIso} upcoming={myDay.upcoming} noClassesToday={!classesToday} />
              ) : myDay.error ? (
                <ChangesUnknown error={myDay.error} onRetry={myDay.retry} />
              ) : (
                classesToday && <ChangesChecking />
              ))}
            <section className="flex flex-col gap-3 print:hidden" aria-label="Today">
              <h2 className="text-xl font-bold">Today</h2>
              <TodayPanel data={data} entries={todayEntries} role={activeRole} clock={clock} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold print:hidden">Your week</h2>
              <TimetableGrid
                data={data}
                entries={mine}
                view={activeRole}
                highlightDay={clock?.day}
                highlightPeriod={periodNow ? Number(periodNow) : undefined}
              />
              <SubjectKey data={data} entries={mine} view={activeRole} />
              <CalendarExport data={data} entries={mine} view={activeRole} label={myLabel ?? myId} />
            </section>
          </>
        )}

        {source.kind === "published" && myId && (
          <AskBox
            code={source.college.code}
            examples={
              activeRole === "teacher"
                ? ["What's my next class?", "When am I free tomorrow?", "Is any room free right now?"]
                : ["Where's my next class?", "What do I have tomorrow?", "Is any room free right now?"]
            }
            context={() => ({
              now: localNow(dateIso ?? isoDate(new Date()), clock?.minutes),
              me: { role: activeRole, id: myId },
            })}
          />
        )}
      </main>
    </>
  );
}
