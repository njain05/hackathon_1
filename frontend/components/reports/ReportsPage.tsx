"use client";

import Link from "next/link";
import { useMemo } from "react";
import AppNav from "@/components/AppNav";
import ExportButtons from "@/components/timetable/ExportButtons";
import { useAccess } from "@/lib/access";
import { LOW_USE, oneDecimal, percent, plural, roomUsage, sectionLoad, teacherWorkload, weekSlots } from "@/lib/reports";
import { useStoredTimetable } from "@/lib/result";
import { RoomReport, SectionReport } from "./UsageReports";
import WorkloadReport from "./WorkloadReport";

function Note({ title, children, action }: { title: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">{title}</h1>
      <div className="text-lg text-ink-soft">{children}</div>
      <div>{action}</div>
    </main>
  );
}

/** A headline number: label, value (proportional figures), one line of context. */
function Tile({ label, value, note, alert }: { label: string; value: string; note: string; alert?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-paper p-3 sm:p-4">
      <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
      <dd className={`text-3xl font-bold proportional-nums ${alert ? "text-err" : ""}`}>{value}</dd>
      <dd className="text-sm text-ink-soft">{note}</dd>
    </div>
  );
}

export default function ReportsPage() {
  const access = useAccess();
  const stored = useStoredTimetable();
  const reports = useMemo(() => {
    if (!stored) return null;
    const { data, result } = stored;
    return {
      workload: teacherWorkload(data, result.entries),
      rooms: roomUsage(data, result.entries),
      sections: sectionLoad(data, result.entries),
    };
  }, [stored]);

  if (access === undefined || stored === undefined) return <p className="p-8 text-ink-soft">Loading…</p>;

  if (!access.staff)
    return (
      <>
        <AppNav />
        <Note
          title="Reports are for the timetable team"
          action={
            <Link href="/my" className="btn-primary !px-5 !py-3 !text-base">
              Open my timetable
            </Link>
          }
        >
          This page shows teacher workload and room usage for the people who make the timetable. Your own classes are on
          My timetable.
        </Note>
      </>
    );

  if (!stored || !reports)
    return (
      <>
        <AppNav />
        <Note
          title="No timetable to report on yet"
          action={
            <Link href="/setup" className="btn-primary">
              Go to setup
            </Link>
          }
        >
          Enter your college in the setup and press Generate timetable on the last step. Reports then show how many periods
          each teacher has, which rooms sit mostly empty, and how full each section&apos;s week is.
        </Note>
      </>
    );

  const { data, result, at } = stored;
  const { workload, rooms, sections } = reports;
  const slots = weekSlots(data);
  const flagged = workload.teachers.filter((t) => t.flags.length).length;
  const freeable = rooms.filter((r) => r.share < LOW_USE).length;
  const avgFree = sections.length ? sections.reduce((n, s) => n + s.free, 0) / sections.length : 0;

  return (
    <>
      <AppNav collegeName={data.name} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold sm:text-3xl">Reports</h1>
            <p className="text-ink-soft">
              From the timetable generated{" "}
              {new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} for {data.name}.{" "}
              <Link href="/timetable" className="font-semibold text-navy underline print:hidden">
                See the timetables
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2 print:hidden">
            <button type="button" className="btn-quiet" onClick={() => window.print()}>
              Print report
            </button>
            <ExportButtons data={data} result={result} />
          </div>
        </div>

        <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm print:hidden">
          <a href="#workload" className="font-semibold text-navy underline">
            Teacher workload
          </a>
          <a href="#rooms" className="font-semibold text-navy underline">
            Room usage
          </a>
          <a href="#sections" className="font-semibold text-navy underline">
            Section load
          </a>
        </nav>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
          <Tile
            label="Average teacher load"
            value={`${oneDecimal(workload.collegeAverage)}`}
            note={`periods a week, across ${plural(workload.teaching, "teacher")}`}
          />
          <Tile
            label="Teachers flagged"
            value={String(flagged)}
            note={flagged ? "far above their department's average or over a limit" : "no one is overloaded"}
            alert={flagged > 0}
          />
          <Tile
            label="Rooms that could be freed"
            value={String(freeable)}
            note={`used for less than ${percent(LOW_USE)} of the week`}
          />
          <Tile
            label="Free periods per section"
            value={oneDecimal(avgFree)}
            note={`on average, out of ${slots} periods a week`}
          />
        </dl>

        <WorkloadReport report={workload} />
        <RoomReport rooms={rooms} days={data.settings.days.length} periods={data.settings.periods_per_day} />
        <SectionReport sections={sections} slots={slots} />
      </main>
    </>
  );
}
