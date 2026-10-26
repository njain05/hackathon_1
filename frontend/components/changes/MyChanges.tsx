"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  type Change,
  type ChangeViewer,
  type DayView,
  addDays,
  addLeave,
  affects,
  changeText,
  getChanges,
  getDay,
  isoDate,
  shortDate,
} from "@/lib/changes";
import type { CollegeData } from "@/lib/types";

const UPCOMING_DAYS = 6;

/**
 * Today's actual timetable (published week + today's changes) and the changes
 * coming up this week, for the college open on this device.
 */
export function useMyDay(code: string | null, date: string | null) {
  const [state, setState] = useState<{ key: string; day: DayView | null; upcoming: Change[] }>({ key: "", day: null, upcoming: [] });
  const key = `${code}|${date}`;
  useEffect(() => {
    if (!code || !date) return;
    let live = true;
    Promise.all([getDay(code, date), getChanges(code, date, addDays(date, UPCOMING_DAYS))])
      .then(([day, upcoming]) => live && setState({ key, day, upcoming }))
      .catch(() => undefined); // offline or asleep: the published week still shows
    return () => {
      live = false;
    };
  }, [code, date, key]);
  return state.key === key ? state : { key, day: null, upcoming: [] };
}

/** "Changes today" at the top of My timetable, then what's coming up this week. */
export function ChangesFeed({ data, me, date, upcoming }: { data: CollegeData; me: ChangeViewer; date: string; upcoming: Change[] }) {
  const mine = upcoming.filter((c) => affects(c, me));
  const today = mine.filter((c) => c.date === date);
  const later = mine.filter((c) => c.date !== date);
  return (
    <section aria-label="Changes" className="flex flex-col gap-3 print:hidden">
      <h2 className="text-xl font-bold">Changes today</h2>
      {today.length === 0 ? (
        <p className="text-ink-soft">No changes today. Classes run as usual.</p>
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

/** A teacher reports leave from their own phone. The admin then arranges cover. */
export function MarkLeave({ code, data, teacherId }: { code: string; data: CollegeData; teacherId: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = data.settings.periods_per_day;

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button type="button" className="btn-quiet" onClick={() => { setOpen(true); setDone(null); }}>
          Mark leave
        </button>
        {done && <span className="font-semibold text-ok">{done}</span>}
      </div>
    );

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await addLeave(code, { teacher_id: teacherId, date, reason, ...(whole ? {} : { start_period: from, end_period: to }) });
      setDone(`Leave noted for ${shortDate(date)}. The timetable in-charge will arrange cover, and your classes will show the change.`);
      setOpen(false);
      setReason("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Mark leave" className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4 print:hidden">
      <h2 className="text-lg font-bold">Mark leave</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="field-label">Date</span>
          <input type="date" className="field" min={isoDate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div role="group" aria-label="How long" className="flex rounded-md border border-line bg-cream p-1">
          {[true, false].map((w) => (
            <button
              key={String(w)}
              type="button"
              aria-pressed={whole === w}
              onClick={() => setWhole(w)}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${whole === w ? "bg-sky/50" : "hover:bg-blush"}`}
            >
              {w ? "Whole day" : "Some periods"}
            </button>
          ))}
        </div>
        {!whole && (
          <>
            <label className="flex flex-col gap-1">
              <span className="field-label">From period</span>
              <select className="field" value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to < v) setTo(v); }}>
                {[...Array(n)].map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="field-label">To period</span>
              <select className="field" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {[...Array(n)].map((_, i) => i + 1 >= from && <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="field-label">Reason (optional)</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy || !date} onClick={send}>
          {busy ? "Sending…" : "Send to the timetable in-charge"}
        </button>
        <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="font-semibold text-err">{error}</p>}
    </section>
  );
}
