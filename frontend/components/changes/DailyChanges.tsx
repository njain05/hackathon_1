"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import { periodText } from "@/lib/bookings";
import {
  type AffectedClass,
  type CoverView,
  type SlotOption,
  TIER_TEXT,
  addChange,
  addDays,
  addLeave,
  changeText,
  extraSlots,
  getCover,
  isoDate,
  names,
  removeChange,
  removeLeave,
} from "@/lib/changes";
import { type AdminAccess, getPublished, useAdminAccess } from "@/lib/cloud";
import type { CollegeData } from "@/lib/types";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function dayTitle(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** Mark a teacher's leave: whole day or some periods. */
function LeaveForm({ data, admin, date, onDone }: { data: CollegeData; admin: AdminAccess; date: string; onDone: () => void }) {
  const [teacher, setTeacher] = useState("");
  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = data.settings.periods_per_day;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await addLeave(admin.code, { teacher_id: teacher, date, reason, ...(whole ? {} : { start_period: from, end_period: to }) }, admin);
      setTeacher("");
      setReason("");
      onDone();
    } catch (e) {
      setError(errorText(e, "Couldn't save the leave."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="field-label">Teacher on leave</span>
          <select className="field min-w-56" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">Choose…</option>
            {data.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
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
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Medical leave" />
        </label>
        <button type="button" className="btn-primary" disabled={!teacher || busy} onClick={save}>
          {busy ? "Saving…" : "Mark leave"}
        </button>
      </div>
      {error && <p className="font-semibold text-err">{error}</p>}
    </div>
  );
}

/** One class a leave affects: assign a ranked substitute, or cancel it. */
function ClassCover({ cls, data, admin, date, leaveId, onDone }: {
  cls: AffectedClass;
  data: CollegeData;
  admin: AdminAccess;
  date: string;
  leaveId: number;
  onDone: () => void;
}) {
  const n = names(data);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = all ? cls.suggestions : cls.suggestions.slice(0, 4);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      onDone();
    } catch (e) {
      setError(errorText(e, "Couldn't save that. Try again."));
      setBusy(false);
    }
  };
  const base = { date, section_id: cls.section_id, start_period: cls.start_period, end_period: cls.end_period, leave_id: leaveId };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-cream p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto">
          <span className="font-semibold">
            {cls.section_id} · {n.subject(cls.subject_id)}
            {cls.class_kind === "lab" ? " lab" : ""}
          </span>{" "}
          <span className="text-ink-soft">
            {periodText(data, cls.start_period, cls.end_period)} · {n.room(cls.room_id)}
          </span>
        </span>
        {cls.state === "needs_cover" ? (
          <span className="rounded-full bg-blush px-3 py-1 text-sm font-semibold text-err">Needs cover</span>
        ) : (
          <>
            <span className="rounded-full bg-mint px-3 py-1 text-sm font-semibold text-ok">
              {cls.state === "substitute" ? `Covered by ${n.teacher(cls.new_teacher_id)}` : "Cancelled"}
            </span>
            <button type="button" className="btn-quiet !py-1" disabled={busy} onClick={() => act(() => removeChange(admin, cls.change_id!))}>
              Undo
            </button>
          </>
        )}
      </div>
      {cls.state === "needs_cover" && (
        <>
          {cls.suggestions.length === 0 ? (
            <p className="text-ink-soft">Nobody suitable is free then. Cancel the class, or add a makeup class later.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Suggested substitutes">
              {shown.map((s) => (
                <li key={s.teacher_id} className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto">
                    <span className="font-semibold">{n.teacher(s.teacher_id)}</span>{" "}
                    <span className="text-sm text-ink-soft">
                      {TIER_TEXT[s.tier]} · {s.load_today} {s.load_today === 1 ? "class" : "classes"} that day
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn-quiet !py-1"
                    disabled={busy}
                    onClick={() => act(() => addChange(admin, { ...base, kind: "substitute", new_teacher_id: s.teacher_id }))}
                  >
                    Assign
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {cls.suggestions.length > 4 && (
              <button type="button" className="text-sm font-semibold text-navy underline" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${cls.suggestions.length} free teachers`}
              </button>
            )}
            <button type="button" className="btn-quiet !py-1 ml-auto" disabled={busy} onClick={() => act(() => addChange(admin, { ...base, kind: "cancel" }))}>
              Cancel this class
            </button>
          </div>
        </>
      )}
      {error && <p className="font-semibold text-err">{error}</p>}
    </li>
  );
}

/** Find periods where a section, its teacher and a room are all free, then book one. */
function ExtraClass({ data, admin, date, onDone }: { data: CollegeData; admin: AdminAccess; date: string; onDone: () => void }) {
  const n = names(data);
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");
  const [teacher, setTeacher] = useState("");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<{ key: string; list: SlotOption[] | null; error: string | null } | null>(null);
  const [rooms, setRooms] = useState<Record<number, string>>({});
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjects = data.assignments.filter((a) => a.section_id === section);
  const assigned = subjects.find((a) => a.subject_id === subject)?.teacher_id ?? "";
  const who = teacher || assigned;
  const key = `${date}|${section}|${who}|${tick}`;

  useEffect(() => {
    if (!section || !subject || !who) return;
    let live = true;
    extraSlots(admin, date, section, who)
      .then((list) => live && setSlots({ key, list, error: null }))
      .catch((e: unknown) => live && setSlots({ key, list: null, error: errorText(e, "Couldn't find free periods.") }));
    return () => {
      live = false;
    };
  }, [admin, date, section, subject, who, key]);

  const current = slots?.key === key ? slots : null;

  const book = async (period: number, room: string) => {
    setBusy(true);
    setError(null);
    try {
      await addChange(admin, { date, kind: "extra", section_id: section, subject_id: subject, teacher_id: who, start_period: period, room_id: room, note });
      setTick((t) => t + 1); // the booked period is no longer free
      setNote("");
      onDone();
    } catch (e) {
      setError(errorText(e, "Couldn't book the class."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="field-label">Section</span>
          <select className="field" value={section} onChange={(e) => { setSection(e.target.value); setSubject(""); setTeacher(""); }}>
            <option value="">Choose…</option>
            {data.sections.map((s) => <option key={s.id} value={s.id}>{n.section(s.id)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Subject</span>
          <select className="field" value={subject} disabled={!section} onChange={(e) => { setSubject(e.target.value); setTeacher(""); }}>
            <option value="">Choose…</option>
            {subjects.map((a) => <option key={a.subject_id} value={a.subject_id}>{n.subject(a.subject_id)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Teacher</span>
          <select className="field" value={who} disabled={!subject} onChange={(e) => setTeacher(e.target.value)}>
            {!subject && <option value="">Choose a subject first</option>}
            {data.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === assigned ? " (usual teacher)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="field-label">Note (optional)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Makeup for Monday" />
        </label>
      </div>
      {section && subject && who && (
        !current ? (
          <p className="hint">Finding periods when everyone is free…</p>
        ) : current.error ? (
          <p className="font-semibold text-err">{current.error}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Periods">
            {current.list!.map((s) => (
              <li key={s.period} className={`flex flex-col gap-1.5 rounded-md border p-2 text-sm ${s.ok ? "border-line bg-cream" : "border-line bg-blush/50 text-ink-soft"}`}>
                <span className="font-semibold text-ink">{periodText(data, s.period, s.period)}</span>
                {s.ok ? (
                  <>
                    <select
                      className="field !py-1"
                      aria-label={`Room for period ${s.period}`}
                      value={rooms[s.period] ?? s.rooms[0]}
                      onChange={(e) => setRooms({ ...rooms, [s.period]: e.target.value })}
                    >
                      {s.rooms.map((r) => <option key={r} value={r}>{n.room(r)}</option>)}
                    </select>
                    <button type="button" className="btn-primary !py-1" disabled={busy} onClick={() => book(s.period, rooms[s.period] ?? s.rooms[0])}>
                      Book this period
                    </button>
                  </>
                ) : (
                  <span>{s.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      {error && <p className="font-semibold text-err">{error}</p>}
    </div>
  );
}

/** Admin: one date's leave, cover and extra classes, on top of the published timetable. */
export default function DailyChanges() {
  const admin = useAdminAccess();
  const [picked, setDate] = useState<string | null>(null);
  // "Today" is read only in the browser (admin is undefined while prerendering).
  const date = admin ? (picked ?? isoDate(new Date())) : "";
  const [data, setData] = useState<{ code: string; value: CollegeData } | null>(null);
  const [view, setView] = useState<{ key: string; value: CoverView | null; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((r) => r + 1);

  const code = admin?.code;
  useEffect(() => {
    if (!code) return;
    getPublished(code)
      .then((t) => setData({ code, value: t.data }))
      .catch(() => undefined);
  }, [code]);

  const key = `${code}|${date}|${reload}`;
  useEffect(() => {
    if (!admin) return;
    let live = true;
    getCover(admin, date)
      .then((v) => live && setView({ key, value: v, error: null }))
      .catch((e: unknown) => live && setView({ key, value: null, error: errorText(e, "Couldn't load this day.") }));
    return () => {
      live = false;
    };
  }, [admin, date, key]);

  const college = data?.code === code ? data?.value : null;
  const current = view?.key === key ? view : null;
  const v = current?.value;
  const changeLines = useMemo(() => (v && college ? v.changes.map((c) => ({ c, text: changeText(c, college, { role: "admin" }) })) : []), [v, college]);

  if (admin === undefined) return <p className="p-8 text-ink-soft">Loading…</p>;
  if (!admin)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Daily changes</h1>
          <p className="text-lg text-ink-soft">
            Leave, substitutes and extra classes are arranged by the timetable in-charge. Open your admin link first, then
            come back here. Teachers can report their own leave on the My timetable page.
          </p>
          <Link href="/my" className="btn-quiet w-fit">
            My timetable
          </Link>
        </main>
      </>
    );

  const needCover = v?.leaves.reduce((sum, lv) => sum + lv.classes.filter((c) => c.state === "needs_cover").length, 0) ?? 0;

  return (
    <>
      <AppNav collegeName={college?.name} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold sm:text-3xl">Daily changes</h1>
          <p className="text-ink-soft">
            Teacher leave, substitutes, cancelled and extra classes for one day. The published timetable stays as it is;
            students and teachers see these changes on their My timetable page.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <button type="button" className="btn-quiet" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
            ←
          </button>
          <label className="flex flex-col gap-1">
            <span className="field-label">Day</span>
            <input type="date" className="field" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <button type="button" className="btn-quiet" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
            →
          </button>
          <span className="ml-2 text-lg font-bold">{dayTitle(date)}</span>
          {v && !v.working_day && <span className="hint">No classes on this day normally. Makeup classes are fine.</span>}
        </div>

        {current?.error && <p className="font-semibold text-err">{current.error}</p>}
        {!college && <p className="text-ink-soft">Loading…</p>}

        {/* The forms stay mounted when the day changes; only the day's lists reload. */}
        {college && (
          <>
            {!v ? (
              <p className="text-ink-soft">Loading the day…</p>
            ) : (
              <p
                className={`rounded-md border px-3 py-2 font-semibold ${v.check.ok ? "border-ok/40 bg-paper text-ok" : "border-err/40 bg-blush text-err"}`}
                aria-live="polite"
              >
                {v.check.ok
                  ? `Verified: 0 clashes on this day${v.changes.length ? `, with ${v.changes.length} change${v.changes.length === 1 ? "" : "s"}` : ""}.`
                  : `This day has a problem: ${(v.check.clashes[0] ?? v.check.violations[0])?.message}`}
                {needCover > 0 && <span className="text-err"> {needCover} class{needCover === 1 ? " needs" : "es need"} cover.</span>}
              </p>
            )}

            <section className="flex flex-col gap-3" aria-label="Teachers on leave">
              <h2 className="text-xl font-bold">Teachers on leave</h2>
              <LeaveForm data={college} admin={admin} date={date} onDone={refresh} />
              {!v ? null : v.leaves.length === 0 ? (
                <p className="text-ink-soft">Nobody is on leave this day.</p>
              ) : (
                v.leaves.map((lv) => {
                  const n = names(college);
                  const whole = lv.start_period === 1 && lv.end_period === college.settings.periods_per_day;
                  return (
                    <article key={lv.id} className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
                      <header className="flex flex-wrap items-center gap-2">
                        <h3 className="mr-auto text-lg font-bold">
                          {n.teacher(lv.teacher_id)}{" "}
                          <span className="font-normal text-ink-soft">
                            {whole ? "whole day" : periodText(college, lv.start_period, lv.end_period).replace(/^P/, "p")}
                            {lv.reason && ` · ${lv.reason}`} · {lv.by === "teacher" ? "reported by the teacher" : "added by admin"}
                          </span>
                        </h3>
                        <button
                          type="button"
                          className="btn-quiet !py-1"
                          onClick={async () => {
                            if (!window.confirm("Remove this leave? Substitutes and cancellations made for it are removed too.")) return;
                            await removeLeave(admin, lv.id).catch(() => undefined);
                            refresh();
                          }}
                        >
                          Remove leave
                        </button>
                      </header>
                      {lv.classes.length === 0 ? (
                        <p className="text-ink-soft">No classes in these periods. Nothing to arrange.</p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {lv.classes.map((cls) => (
                            <ClassCover
                              key={`${cls.section_id}-${cls.start_period}`}
                              cls={cls}
                              data={college}
                              admin={admin}
                              date={date}
                              leaveId={lv.id}
                              onDone={refresh}
                            />
                          ))}
                        </ul>
                      )}
                    </article>
                  );
                })
              )}
            </section>

            <section className="flex flex-col gap-3" aria-label="Extra or makeup class">
              <h2 className="text-xl font-bold">Extra or makeup class</h2>
              <p className="text-ink-soft">Shows only periods when the section, the teacher and a suitable room are all free.</p>
              <ExtraClass data={college} admin={admin} date={date} onDone={refresh} />
            </section>

            <section className="flex flex-col gap-3" aria-label="All changes">
              <h2 className="text-xl font-bold">All changes on {dayTitle(date)}</h2>
              {!v ? null : changeLines.length === 0 ? (
                <p className="text-ink-soft">No changes. Classes run as published.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {changeLines.map(({ c, text }) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-2">
                      <span className="mr-auto">{text}</span>
                      <button
                        type="button"
                        className="btn-quiet !py-1"
                        onClick={async () => {
                          await removeChange(admin, c.id).catch(() => undefined);
                          refresh();
                        }}
                      >
                        Undo
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
