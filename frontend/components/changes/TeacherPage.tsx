"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import { ago, type Booking, getMyBookings, periodText } from "@/lib/bookings";
import { StatusBadge, whereItIs } from "@/components/bookings/common";
import { type Leave, LEAVE_STATUS, addLeave, getMyLeaves, isoDate, shortDate } from "@/lib/changes";
import { getPublished } from "@/lib/cloud";
import { type MemberAccess, setMemberAccess, useMemberAccess, useOpenMemberLink } from "@/lib/members";
import type { CollegeData } from "@/lib/types";
import { ChangesFeed, ChangesUnknown, useMyDay } from "./MyChanges";
import PageLoading from "@/components/ui/PageLoading";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function periodsText(d: CollegeData | null, lv: Pick<Leave, "start_period" | "end_period">): string {
  if (!d) return `periods ${lv.start_period}–${lv.end_period}`;
  if (lv.start_period === 1 && lv.end_period === d.settings.periods_per_day) return "whole day";
  return periodText(d, lv.start_period, lv.end_period).replace(/^P/, "p");
}

/** Where a request stands, in words: waiting, approved (and by whom), or not approved and why. */
export function leaveStatusText(lv: Leave): string {
  if (lv.status === "pending") return `Waiting for ${lv.waiting_for}${lv.waiting_since ? `, asked ${ago(lv.waiting_since)}` : ""}`;
  const note = lv.decision_note ? `: “${lv.decision_note}”` : "";
  return lv.status === "approved" ? `Approved by ${lv.decided_by}${note}` : `Not approved by ${lv.decided_by}${note}`;
}

const BADGE: Record<Leave["status"], string> = {
  pending: "bg-blush text-ink",
  approved: "bg-mint text-ok",
  rejected: "bg-blush text-err",
};

export function LeaveBadge({ status }: { status: Leave["status"] }) {
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${BADGE[status]}`}>{LEAVE_STATUS[status]}</span>;
}

function LeaveRequestForm({ teacher, data, onSent }: { teacher: MemberAccess; data: CollegeData; onSent: (l: Leave) => void }) {
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = data.settings.periods_per_day;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onSent(await addLeave(teacher.college_code, { date, reason, ...(whole ? {} : { start_period: from, end_period: to }) }, { member: teacher }));
      setReason("");
    } catch (e) {
      setError(errorText(e, "Couldn't send. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Ask for leave" className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
      <h2 className="text-lg font-bold">Ask for leave</h2>
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
          <span className="field-label">Reason (seen only by your HOD and the Dean)</span>
          <input className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Medical leave" />
        </label>
      </div>
      <div>
        <button type="button" className="btn-primary" disabled={busy || !date} onClick={send}>
          {busy ? "Sending…" : "Send to my HOD"}
        </button>
      </div>
      {error && (
        <p role="alert" className="font-semibold text-err">
          {error}
        </p>
      )}
    </section>
  );
}

/** The teacher's room requests: where each one is (their HOD, then the Dean). */
function MyRoomRequests({ teacher }: { teacher: MemberAccess }) {
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getMyBookings(teacher)
      .then(setList)
      .catch((e: unknown) => setError(errorText(e, "Couldn't load your room requests.")));
  }, [teacher]);
  return (
    <section aria-label="Your room requests" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold">Your room requests</h2>
        <Link href="/book" className="btn-primary">
          Book a room
        </Link>
      </div>
      <p className="text-ink-soft">For an event, a study session or anything else: any room that’s free. It goes to your HOD, then the Dean.</p>
      {error && <p className="font-semibold text-err">{error}</p>}
      {!list && !error && <p className="text-ink-soft">Loading…</p>}
      {list && list.length === 0 && <p className="text-ink-soft">No room requests yet.</p>}
      {list && list.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.map((b) => (
            <li key={b.id} className="flex flex-col gap-1 rounded-md border border-line bg-paper p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/track/${encodeURIComponent(b.token)}`} className="mr-auto font-semibold text-navy underline">
                  {b.title}
                </Link>
                <StatusBadge status={b.status} />
              </div>
              <span className="text-sm text-ink-soft">
                {b.room_name} · {shortDate(b.date)},{" "}
                {b.start_period === b.end_period ? `period ${b.start_period}` : `periods ${b.start_period}–${b.end_period}`}
              </span>
              <span>{whereItIs(b)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A teacher's own page, opened only from their private link: ask for leave and follow it. */
export default function TeacherPage() {
  const opening = useOpenMemberLink("teacher");
  const teacher = useMemberAccess("teacher");
  const [data, setData] = useState<CollegeData | null>(null);
  const [leaves, setLeaves] = useState<{ key: string; list: Leave[] | null; error: string | null } | null>(null);
  const [sent, setSent] = useState<Leave | null>(null);
  const [tick, setTick] = useState(0);
  const key = teacher ? `${teacher.college_code}|${teacher.key}|${tick}` : "";
  // "Today" only in the browser: `teacher` is undefined while prerendering.
  const today = teacher ? isoDate(new Date()) : null;
  const myDay = useMyDay(teacher?.college_code ?? null, today);

  const code = teacher?.college_code;
  useEffect(() => {
    if (!code) return;
    getPublished(code)
      .then((t) => setData(t.data))
      .catch(() => undefined);
  }, [code]);

  useEffect(() => {
    if (!teacher) return;
    let live = true;
    getMyLeaves(teacher)
      .then((list) => live && setLeaves({ key, list, error: null }))
      .catch((e: unknown) => live && setLeaves({ key, list: null, error: errorText(e, "Couldn't load your requests.") }));
    return () => {
      live = false;
    };
  }, [teacher, key]);

  // Coming back to the page (e.g. after the HOD decided): show the latest.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (teacher === undefined || opening.opening) return <PageLoading />;

  if (!teacher)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Teacher page</h1>
          {opening.error && <p className="text-lg font-semibold text-err">{opening.error}</p>}
          <p className="text-lg text-ink-soft">
            This page is for teachers: ask for leave, book a room and see your changes. Sign in with the username and password
            the Dean’s office gave you.
          </p>
          <Link href="/login" className="btn-primary w-fit !px-5 !py-3 !text-base">
            Sign in
          </Link>
        </main>
      </>
    );

  const current = leaves?.key === key ? leaves : null;
  const list = current?.list ?? [];

  return (
    <>
      <AppNav collegeName={teacher.college_name} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-ink-soft">Teacher page · {teacher.department_name}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Hello, {teacher.name}</h1>
          <p className="text-ink-soft">
            Ask for leave or book a room here. Leave goes to your HOD, who arranges cover; rooms go to your HOD, then the
            Dean. Your week is on{" "}
            <Link href="/my" className="font-semibold text-navy underline">
              My timetable
            </Link>
            .
          </p>
        </div>

        {data && (
          <LeaveRequestForm
            teacher={teacher}
            data={data}
            onSent={(l) => {
              setSent(l);
              setTick((t) => t + 1);
            }}
          />
        )}
        {sent && (
          <p role="status" className="rounded-md bg-mint px-3 py-2 font-semibold">
            Sent. Your leave on {shortDate(sent.date)} is {sent.status === "approved" ? "approved" : `waiting for ${sent.waiting_for}`}.
          </p>
        )}

        <section aria-label="Your leave requests" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-xl font-bold">Your leave requests</h2>
            <button
              type="button"
              className="btn-quiet !py-1"
              onClick={() => {
                setSent(null);
                setTick((t) => t + 1);
              }}
            >
              Refresh
            </button>
          </div>
          {current?.error && <p className="font-semibold text-err">{current.error}</p>}
          {!current ? (
            <p className="text-ink-soft">Loading…</p>
          ) : list.length === 0 ? (
            <p className="text-ink-soft">No leave requests yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((lv) => (
                <li key={lv.id} className="flex flex-col gap-1 rounded-md border border-line bg-paper p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-auto font-semibold">
                      {shortDate(lv.date)}, {periodsText(data, lv)}
                      {lv.reason && <span className="font-normal text-ink-soft"> · {lv.reason}</span>}
                    </span>
                    <LeaveBadge status={lv.status} />
                  </div>
                  <span>{leaveStatusText(lv)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <MyRoomRequests teacher={teacher} />

        {data && today && myDay.day && (
          <ChangesFeed data={data} me={{ role: "teacher", id: teacher.teacher_id ?? "" }} date={today} upcoming={myDay.upcoming} />
        )}
        {!myDay.day && myDay.error && <ChangesUnknown error={myDay.error} onRetry={myDay.retry} />}

        <button
          type="button"
          className="w-fit text-sm font-semibold text-navy underline"
          onClick={() => window.confirm("Forget your teacher link on this device? You'll need the link again to come back.") && setMemberAccess("teacher", null)}
        >
          Not you? Forget this link on this device
        </button>
      </main>
    </>
  );
}
