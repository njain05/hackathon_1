"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { periodText } from "@/lib/bookings";
import { type CoverView, addDays, getCover, isoDate, names } from "@/lib/changes";
import type { MemberAccess } from "@/lib/members";
import type { CollegeData } from "@/lib/types";
import { ClassCover } from "./DailyChanges";

const dayTitle = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

/**
 * The HOD arranges cover for their own department's classes: for any teacher away that day
 * (theirs or another department's who teaches their sections), once the leave is approved.
 */
export default function HodCover({ hod, data }: { hod: MemberAccess; data: CollegeData | null }) {
  const [picked, setDate] = useState<string | null>(null);
  const date = picked ?? isoDate(new Date()); // only rendered in the browser (the HOD link lives there)
  const [view, setView] = useState<{ day: string; value: CoverView | null; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    getCover({ member: hod }, date)
      .then((v) => live && setView({ day: date, value: v, error: null }))
      .catch((e: unknown) => live && setView({ day: date, value: null, error: e instanceof ApiError ? e.message : "Couldn't load this day." }));
    return () => {
      live = false;
    };
  }, [hod, date, reload]);

  const v = view?.day === date ? view.value : null;
  const n = data ? names(data) : null;
  const leaves = v?.leaves.filter((lv) => lv.classes.length > 0) ?? [];
  const waiting = leaves.reduce((sum, lv) => sum + lv.classes.filter((c) => c.state === "needs_cover").length, 0);

  return (
    <section aria-label="Leave cover" className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">Leave cover for {hod.department_name}</h2>
        <p className="text-ink-soft">
          Classes of your department’s sections whose teacher is away, once the leave is approved. Pick a substitute (best
          first) or cancel the class. Students see it on their timetable.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-quiet" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
          ←
        </button>
        <input type="date" aria-label="Day" className="field" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button type="button" className="btn-quiet" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}>
          →
        </button>
        <span className="font-bold">{dayTitle(date)}</span>
      </div>
      {view?.day === date && view.error && <p className="font-semibold text-err">{view.error}</p>}
      {!v ? (
        !view?.error && <p className="text-ink-soft">Loading the day…</p>
      ) : leaves.length === 0 ? (
        <p className="text-ink-soft">No teacher is away from your department’s classes this day.</p>
      ) : (
        <>
          {waiting > 0 && (
            <p className="font-semibold text-err">
              {waiting} class{waiting === 1 ? " needs" : "es need"} cover.
            </p>
          )}
          {leaves.map((lv) => (
            <article key={lv.id} className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
              <h3 className="font-bold">
                {n?.teacher(lv.teacher_id) ?? lv.teacher_id}{" "}
                <span className="font-normal text-ink-soft">
                  {data && !(lv.start_period === 1 && lv.end_period === data.settings.periods_per_day)
                    ? periodText(data, lv.start_period, lv.end_period).replace(/^P/, "p")
                    : "whole day"}
                  {lv.status === "pending" && ` · leave waiting for ${lv.waiting_for}`}
                </span>
              </h3>
              <ul className="flex flex-col gap-2">
                {lv.classes.map((cls) =>
                  data ? (
                    <ClassCover
                      key={`${cls.section_id}-${cls.start_period}`}
                      cls={cls}
                      data={data}
                      auth={{ member: hod }}
                      date={date}
                      leaveId={lv.id}
                      teacherId={lv.teacher_id}
                      onDone={() => setReload((r) => r + 1)}
                    />
                  ) : null,
                )}
              </ul>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
