"use client";

import { useState } from "react";
import {
  HEAVY_MIN_GAP,
  HEAVY_RATIO,
  MIN_DEPT_TEACHERS,
  oneDecimal,
  plural,
  type DayCount,
  type TeacherLoad,
  type WorkloadReport as Workload,
} from "@/lib/reports";
import { Bar, FlagBadge, WorkloadKey } from "./Bars";

type SortBy = "load" | "department" | "name";

const SORTS: { id: SortBy; label: string }[] = [
  { id: "load", label: "Most periods" },
  { id: "department", label: "Department" },
  { id: "name", label: "Name" },
];

function sorted(teachers: TeacherLoad[], by: SortBy, deptOrder: string[]): TeacherLoad[] {
  const list = [...teachers];
  if (by === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
  if (by === "department")
    return list.sort(
      (a, b) =>
        (deptOrder.indexOf(a.departmentId) + 1 || 999) - (deptOrder.indexOf(b.departmentId) + 1 || 999) ||
        b.periods - a.periods ||
        a.name.localeCompare(b.name),
    );
  return list; // already most periods first
}

const dayText = (d: DayCount) => `${d.day} (${d.periods || "no classes"})`;

/** "Busiest Tuesday (3), lightest Friday (1)", or "Even: 2 every day". */
function spread(t: TeacherLoad): string {
  if (!t.busiest || !t.lightest) return "";
  if (t.busiest.periods === t.lightest.periods) return `Even: ${plural(t.busiest.periods, "period")} every day`;
  return `Busiest ${dayText(t.busiest)}, lightest ${dayText(t.lightest)}`;
}

function flagText(t: TeacherLoad): string[] {
  return t.flags.map((f) =>
    f.kind === "heavy"
      ? `Heavy load: ${f.ratio.toFixed(1)}× the ${f.department} average of ${oneDecimal(f.average)}`
      : `Over their limit of ${f.limit} periods a week`,
  );
}

function TeacherRow({ t, max, collegeAverage }: { t: TeacherLoad; max: number; collegeAverage: number }) {
  const flags = flagText(t);
  const compare = [
    t.deptAverage !== null ? `${t.departmentId} average ${oneDecimal(t.deptAverage)}` : "",
    `college ${oneDecimal(collegeAverage)}`,
  ].filter(Boolean);
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-1.5 py-3 hover:bg-blush/30 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-center lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,18rem)] print:break-inside-avoid">
      <div className="min-w-0">
        <span className="font-semibold break-words">{t.name}</span>{" "}
        <span className="text-sm text-ink-soft">
          {t.id}
          {t.departmentId ? `, ${t.departmentId}` : ""}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <Bar
          value={t.periods}
          max={max}
          mark={t.deptAverage}
          flagged={flags.length > 0}
          title={`${t.name}: ${plural(t.periods, "period")} a week; ${compare.join(", ")}`}
        />
        <span className="w-24 shrink-0 text-sm">
          <span className="text-base font-bold">{t.periods}</span> a week
        </span>
      </div>
      <div className="text-sm text-ink-soft md:col-start-2 lg:col-start-auto">
        {t.periods === 0 ? (
          "No classes this week"
        ) : (
          <>
            <span className="block">{spread(t)}</span>
            <span className="block">{compare.join(", ")}</span>
          </>
        )}
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2 md:col-start-2 lg:col-end-4">
          {flags.map((f) => (
            <FlagBadge key={f}>{f}</FlagBadge>
          ))}
        </div>
      )}
    </li>
  );
}

export default function WorkloadReport({ report }: { report: Workload }) {
  const [sortBy, setSortBy] = useState<SortBy>("load");
  const { teachers, departments, collegeAverage } = report;
  // One scale for every bar, set by the busiest teacher.
  const max = Math.max(1, ...teachers.map((t) => t.periods), ...teachers.map((t) => t.deptAverage ?? 0));
  const flagged = teachers.filter((t) => t.flags.length);
  const list = sorted(teachers, sortBy, departments.map((d) => d.id));

  return (
    <section aria-labelledby="workload" className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="workload" className="text-xl font-bold">
          Teacher workload
        </h2>
        <p className="text-ink-soft">
          How many periods each teacher teaches a week, compared with their department&apos;s average. Anyone at{" "}
          {HEAVY_RATIO} times their department&apos;s average (and at least {HEAVY_MIN_GAP} periods above it), or over
          their own weekly limit, is flagged.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <div className="rounded-md border border-line bg-cream px-3 py-2">
          <dt className="text-sm text-ink-soft">College average</dt>
          <dd className="font-bold">{oneDecimal(collegeAverage)} periods</dd>
          <dd className="text-sm text-ink-soft">{plural(report.teaching, "teacher")}</dd>
        </div>
        {departments.map((d) => (
          <div key={d.id} className="rounded-md border border-line bg-cream px-3 py-2">
            <dt className="text-sm text-ink-soft">{d.id || "No department"} average</dt>
            <dd className="font-bold">{oneDecimal(d.average)} periods</dd>
            <dd className="text-sm text-ink-soft">{plural(d.teachers, "teacher")}</dd>
          </div>
        ))}
      </dl>

      <p role="status" className={flagged.length ? "font-semibold text-err" : "text-ok"}>
        {flagged.length
          ? `${plural(flagged.length, "teacher")} flagged: ${flagged.map((t) => t.name).join(", ")}.`
          : "No one is far above their department's average or over a weekly limit."}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <WorkloadKey />
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-sm font-semibold whitespace-nowrap" id="workload-sort">
            Sort by
          </span>
          <div role="group" aria-labelledby="workload-sort" className="flex rounded-md border border-line bg-paper p-1">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sortBy === s.id}
                onClick={() => setSortBy(s.id)}
                className={`rounded px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${sortBy === s.id ? "bg-sky/50" : "hover:bg-blush"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {teachers.length === 0 ? (
        <p className="text-ink-soft">There are no teachers in this timetable.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line" aria-label="Teachers">
          {list.map((t) => (
            <TeacherRow key={t.id} t={t} max={max} collegeAverage={collegeAverage} />
          ))}
        </ol>
      )}
      {departments.some((d) => d.teachers < MIN_DEPT_TEACHERS) && (
        <p className="hint">
          Departments with fewer than {MIN_DEPT_TEACHERS} teachers aren&apos;t compared with their average: it says too
          little with so few people. Weekly limits are still checked.
        </p>
      )}
    </section>
  );
}
