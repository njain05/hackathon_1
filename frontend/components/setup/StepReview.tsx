"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, checkCollege, generateTimetable, toApi } from "@/lib/api";
import { loads, localChecks, type Finding } from "@/lib/checks";
import { saveTimetable } from "@/lib/result";
import type { CollegeData, Problem, SolveResult, StepId } from "@/lib/types";

const STEP_NAMES: Record<StepId, string> = {
  week: "College & week",
  rooms: "Rooms",
  teachers: "Teachers",
  sections: "Sections",
  subjects: "Subjects",
  review: "Check",
};

interface Props {
  data: CollegeData;
  goTo: (step: StepId) => void;
}

function Issue({ level, message, suggestion, step, goTo }: Finding & { goTo: Props["goTo"] }) {
  return (
    <li className={`flex flex-wrap items-start gap-x-4 gap-y-1 border-l-4 bg-paper px-3 py-2 ${level === "error" ? "border-err" : "border-sky"}`}>
      <div className="min-w-0 flex-1">
        <p className={level === "error" ? "font-semibold text-err" : "font-semibold"}>{message}</p>
        {suggestion && <p className="hint">{suggestion}</p>}
      </div>
      {step !== "review" && (
        <button type="button" className="btn-quiet !py-1" onClick={() => goTo(step)}>
          Fix in {STEP_NAMES[step]}
        </button>
      )}
    </li>
  );
}

function LoadBars({ title, rows, unit }: { title: string; rows: { id: string; name: string; need: number; cap: number }[]; unit: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-bold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {shown.map((r) => {
          const pct = r.cap ? Math.min(100, (r.need / r.cap) * 100) : 100;
          const over = r.need > r.cap;
          return (
            <li key={r.id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate" title={r.name}>{r.name || r.id}</span>
              <span className="h-3 overflow-hidden rounded-sm bg-blush" aria-hidden>
                <span className={`block h-full ${over ? "bg-err" : "bg-navy"}`} style={{ width: `${pct}%` }} />
              </span>
              <span className={over ? "font-semibold text-err" : "text-ink-soft"}>
                {r.need} of {r.cap} {unit}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > 8 && (
        <button type="button" className="self-start text-sm font-semibold text-navy underline" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export default function StepReview({ data, goTo }: Props) {
  const findings = useMemo(() => localChecks(data), [data]);
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const load = useMemo(() => loads(data), [data]);

  const [server, setServer] = useState<{ for: CollegeData; problems: Problem[] } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [attempt, setAttempt] = useState(0); // "Check again" re-runs the server check
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Ask the server for the deeper checks once the basics are fixed.
  useEffect(() => {
    if (errors.length) return;
    let live = true;
    checkCollege(data)
      .then((r) => {
        if (!live) return;
        setServer({ for: data, problems: r.problems });
        setServerError(null);
      })
      .catch((e: unknown) => {
        if (live) setServerError(e instanceof ApiError ? e.message : "Couldn't run the checks.");
      });
    return () => {
      live = false;
    };
  }, [data, errors.length, attempt]);

  const serverProblems = server?.for === data ? server.problems : null;
  const checking = !errors.length && !serverProblems && !serverError;
  const ready = !errors.length && serverProblems?.length === 0;

  const generate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setResult(null);
    try {
      const r = await generateTimetable(data);
      if (r.status === "solved") {
        // Save exactly what was sent, so Publish gets data that matches the timetable.
        saveTimetable({ data: toApi(data), result: r, at: new Date().toISOString() });
        // Only move on if the admin is still on this step; otherwise the result waits on Timetables.
        if (mounted.current) router.push("/timetable");
      }
      if (mounted.current) setResult(r);
    } catch (e) {
      if (mounted.current) setGenerateError(e instanceof ApiError ? e.message : "Generation failed. Try again.");
    } finally {
      if (mounted.current) setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Days", data.settings.days.length],
          ["Periods a day", data.settings.periods_per_day],
          ["Rooms", data.rooms.length],
          ["Teachers", data.teachers.length],
          ["Sections", data.sections.length],
          ["Classes", data.assignments.length],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border border-line bg-paper px-3 py-2">
            <dt className="text-sm text-ink-soft">{k}</dt>
            <dd className="text-2xl font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="text-lg font-bold">Checks before generating</h2>
        {errors.length > 0 && (
          <>
            <p>
              Fix {errors.length === 1 ? "this" : `these ${errors.length}`} first:
            </p>
            <ul className="flex flex-col gap-2">
              {errors.map((f, i) => <Issue key={i} {...f} goTo={goTo} />)}
            </ul>
          </>
        )}
        {checking && <p className="hint">Checking whether every class can fit…</p>}
        {serverError && (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="font-semibold text-err">{serverError}</p>
            <button
              type="button"
              className="btn-quiet !py-1"
              onClick={() => {
                setServerError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Check again
            </button>
          </div>
        )}
        {serverProblems && serverProblems.length > 0 && (
          <>
            <p>The data is complete, but this setup can’t work yet:</p>
            <ul className="flex flex-col gap-2">
              {serverProblems.map((p, i) => (
                <Issue key={i} level="error" message={p.message} suggestion={p.suggestion} step={p.step ?? "review"} goTo={goTo} />
              ))}
            </ul>
          </>
        )}
        {ready && (
          <p className="rounded-md border border-ok/40 bg-paper px-3 py-2 font-semibold text-ok">
            Everything checks out. Every class has a teacher, a room that fits and enough time in the week.
          </p>
        )}
        {warnings.length > 0 && (
          <details className="rounded-md border border-line bg-paper p-3">
            <summary className="cursor-pointer font-semibold">
              {warnings.length} thing{warnings.length > 1 ? "s" : ""} to look at (won’t stop generation)
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {warnings.map((f, i) => <Issue key={i} {...f} goTo={goTo} />)}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="btn-primary !px-5 !py-3 !text-base" disabled={!ready || generating} onClick={generate}>
            {generating ? "Generating timetable…" : "Generate timetable"}
          </button>
          <p className="hint" aria-live="polite">
            {generating
              ? "Fitting every class around teachers, rooms and breaks, then checking for clashes. This usually takes 5 to 20 seconds."
              : ready
                ? "Usually takes 5 to 20 seconds."
                : "Available once the checks above pass."}
          </p>
        </div>
        {generateError && (
          <p role="alert" className="font-semibold text-err">
            {generateError}
          </p>
        )}
        {result?.status === "solved" && (
          <div className="rounded-md bg-mint px-3 py-2">
            <p className="font-semibold">
              Timetable ready: {result.entries.length} periods placed, {result.check?.clashes.length ?? 0} clashes.
            </p>
            <p className="hint">Opening the timetables…</p>
          </div>
        )}
        {result && result.status !== "solved" && (
          <ul className="flex flex-col gap-2">
            {result.problems.map((p, i) => (
              <Issue key={i} level="error" message={p.message} suggestion={p.suggestion} step={p.step ?? "review"} goTo={goTo} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <LoadBars title="Teacher load per week" rows={load.teachers} unit="periods" />
        <LoadBars title="Section load per week" rows={load.sections} unit="periods" />
      </div>
    </div>
  );
}
