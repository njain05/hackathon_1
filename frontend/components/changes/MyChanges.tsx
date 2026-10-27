"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  type Change,
  type ChangeViewer,
  type DayView,
  addDays,
  affects,
  changeText,
  getChanges,
  getDay,
  shortDate,
} from "@/lib/changes";
import type { CollegeData } from "@/lib/types";

const UPCOMING_DAYS = 6;

/**
 * Today's actual timetable (published week + today's changes) and the changes
 * coming up this week, for the college open on this device.
 */
export function useMyDay(code: string | null, date: string | null) {
  const [state, setState] = useState<{ key: string; day: DayView | null; upcoming: Change[]; error: string | null }>({
    key: "", day: null, upcoming: [], error: null,
  });
  const [tick, setTick] = useState(0);
  const key = `${code}|${date}`;
  useEffect(() => {
    if (!code || !date) return;
    let live = true;
    Promise.all([getDay(code, date), getChanges(code, date, addDays(date, UPCOMING_DAYS))])
      .then(([day, upcoming]) => live && setState({ key, day, upcoming, error: null }))
      // Offline or asleep: the published week still shows, but say that today's changes are unknown.
      .catch((e: unknown) => live && setState((s) => ({ ...s, key, error: e instanceof ApiError ? e.message : "Couldn't check today's changes." })));
    return () => {
      live = false;
    };
  }, [code, date, key, tick]);
  // Check again when the phone comes back online or the app is opened again.
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    const onVisible = () => document.visibilityState === "visible" && again();
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const retry = () => setTick((t) => t + 1);
  return state.key === key ? { ...state, retry } : { key, day: null, upcoming: [], error: null, retry };
}

/** Shown when today's changes couldn't be loaded, so a cancelled class isn't mistaken for a normal one. */
export function ChangesUnknown({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-3 rounded-md bg-blush px-3 py-2 print:hidden">
      <span>
        <span className="font-semibold">Couldn’t check today’s changes</span> (cancelled classes, substitutes). {error}
      </span>
      <button type="button" className="btn-quiet !py-1" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

/** Holds the place of "Changes today" while they load, so the page doesn't jump when they arrive. */
export function ChangesChecking() {
  return (
    <section aria-label="Changes" className="flex flex-col gap-3 print:hidden">
      <h2 className="text-xl font-bold">Changes today</h2>
      <p className="text-ink-soft">Checking for cancelled classes and substitutes…</p>
    </section>
  );
}

/**
 * "Changes today" at the top of My timetable, then what's coming up this week.
 * `noClassesToday`: say nothing about today unless something was added.
 */
export function ChangesFeed({
  data,
  me,
  date,
  upcoming,
  noClassesToday = false,
}: {
  data: CollegeData;
  me: ChangeViewer;
  date: string;
  upcoming: Change[];
  noClassesToday?: boolean;
}) {
  const mine = upcoming.filter((c) => affects(c, me));
  const today = mine.filter((c) => c.date === date);
  const later = mine.filter((c) => c.date !== date);
  if (noClassesToday && today.length === 0 && later.length === 0) return null;
  return (
    <section aria-label="Changes" className="flex flex-col gap-3 print:hidden">
      {!(noClassesToday && today.length === 0) && <h2 className="text-xl font-bold">Changes today</h2>}
      {today.length === 0 ? (
        !noClassesToday && <p className="text-ink-soft">No changes today. Classes run as usual.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {today.map((c) => (
            <li key={c.id} className={`rounded-md border px-3 py-2 font-semibold ${c.kind === "cancel" ? "border-err/40 bg-blush" : "border-line bg-sky/20"}`}>
              {changeText(c, data, me)}
            </li>
          ))}
        </ul>
      )}
      {later.length > 0 && (
        <details className="rounded-md border border-line bg-paper px-3 py-2">
          <summary className="cursor-pointer font-semibold">
            Coming up this week ({later.length} change{later.length === 1 ? "" : "s"})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {later.map((c) => (
              <li key={c.id}>
                <span className="font-semibold">{shortDate(c.date)}:</span> {changeText(c, data, me)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
