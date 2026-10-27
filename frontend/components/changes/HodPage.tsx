"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import { periodText } from "@/lib/bookings";
import { type HodView, type Leave, decideLeave, getHodView, names, shortDate } from "@/lib/changes";
import { getPublished } from "@/lib/cloud";
import { type MemberAccess, setMemberAccess, useMemberAccess, useOpenMemberLink } from "@/lib/members";
import type { CollegeData } from "@/lib/types";
import InchargeLink from "@/components/department/InchargeLink";
import RoomSharing from "@/components/department/RoomSharing";
import HodRequests from "@/components/bookings/HodRequests";
import { type DepartmentState, STATE_TEXT, departmentStatus } from "@/lib/departments";
import HodCover from "./HodCover";
import { LeaveBadge, leaveStatusText } from "./TeacherPage";
import PageLoading from "@/components/ui/PageLoading";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function when(d: CollegeData | null, lv: Leave): string {
  if (!d) return `${shortDate(lv.date)}, periods ${lv.start_period}–${lv.end_period}`;
  const whole = lv.start_period === 1 && lv.end_period === d.settings.periods_per_day;
  return `${shortDate(lv.date)}, ${whole ? "whole day" : periodText(d, lv.start_period, lv.end_period).replace(/^P/, "p")}`;
}

/** One leave request: approve or reject with a note. */
function Request({ lv, hod, data, onDone }: { lv: Leave; hod: MemberAccess; data: CollegeData | null; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teacher = data ? names(data).teacher(lv.teacher_id) : lv.teacher_id;

  const decide = async (action: "approve" | "reject") => {
    if (action === "reject" && !note.trim() && !window.confirm("Reject without a note? The teacher won't see a reason.")) return;
    setBusy(true);
    setError(null);
    try {
      await decideLeave(hod.college_code, lv.id, action, note, { member: hod });
      onDone(action === "approve"
        ? `Approved ${teacher}’s leave. The timetable in-charge can now arrange cover.`
        : `Rejected ${teacher}’s leave. They can see your note on their teacher page.`);
    } catch (e) {
      setError(errorText(e, "Couldn't save your decision. Try again."));
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-lg font-bold">{teacher}</span>
        <LeaveBadge status={lv.status} />
      </div>
      <p>
        <span className="font-semibold">{when(data, lv)}</span>
        {lv.reason && <span className="text-ink-soft"> · {lv.reason}</span>}
      </p>
      {lv.status === "pending" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="field-label">Note for the teacher (optional)</span>
            <input className="field" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => decide("approve")}>
              Approve
            </button>
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => decide("reject")}>
              Reject
            </button>
          </div>
        </>
      ) : (
        <p className="text-ink-soft">{leaveStatusText(lv)}</p>
      )}
      {error && <p className="font-semibold text-err">{error}</p>}
    </li>
  );
}

/** "CSE's timetable data: Waiting for the HOD · Review it": prominent when the HOD has something to approve. */
function DepartmentReview({ hod }: { hod: MemberAccess }) {
  const [state, setState] = useState<DepartmentState | null>(null);
  useEffect(() => {
    departmentStatus({ member: hod })
      .then((all) => setState(all.find((d) => d.department_id === hod.department_id) ?? null))
      .catch(() => undefined); // the department section below still links there
  }, [hod]);
  if (!state) return null;
  const todo = state.state === "submitted";
  return (
    <p
      role={todo ? "status" : undefined}
      className={`flex flex-wrap items-center gap-3 rounded-md px-3 py-2 ${todo ? "bg-blush font-semibold" : "border border-line bg-paper"}`}
    >
      <span className="mr-auto">
        {hod.department_name}’s timetable data: {STATE_TEXT[state.state]}
        {state.note && <span className="font-normal text-ink-soft"> · “{state.note}”</span>}
      </span>
      <Link href="/department" className={todo ? "btn-primary !py-1" : "btn-quiet !py-1"}>
        {todo ? "Review and approve" : "Review it"}
      </Link>
    </p>
  );
}

/** The HOD's page, opened only from their private link: approve their department's leave. */
export default function HodPage() {
  const opening = useOpenMemberLink("hod");
  const hod = useMemberAccess("hod");
  const [data, setData] = useState<CollegeData | null>(null);
  const [view, setView] = useState<{ value: HodView | null; error: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!hod) return;
    getHodView(hod)
      .then((v) => setView({ value: v, error: null }))
      .catch((e: unknown) => setView({ value: null, error: errorText(e, "Couldn't load the leave requests.") }));
  }, [hod]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const code = hod?.college_code;
  useEffect(() => {
    if (!code) return;
    getPublished(code)
      .then((t) => setData(t.data))
      .catch(() => undefined);
  }, [code]);

  if (hod === undefined || opening.opening) return <PageLoading />;

  if (!hod)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">HOD page</h1>
          {opening.error && <p className="text-lg font-semibold text-err">{opening.error}</p>}
          <p className="text-lg text-ink-soft">
            This page is for heads of department. Open the private HOD link the Dean sent you.
          </p>
          <Link href="/my" className="btn-quiet w-fit">
            My timetable
          </Link>
        </main>
      </>
    );

  const v = view?.value;
  const waiting = v?.leaves.filter((l) => l.status === "pending") ?? [];
  const decided = v?.leaves.filter((l) => l.status !== "pending") ?? [];

  return (
    <>
      <AppNav collegeName={hod.college_name} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-ink-soft">HOD page · {hod.department_name}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Leave requests{hod.name ? `, ${hod.name}` : ""}</h1>
          <p className="text-ink-soft">
            Teachers of {hod.department_name} ask for leave from their teacher page. Once you approve, you pick a
            substitute (or cancel) for your department’s classes under “Leave cover”. Classes in other departments are
            covered by their own HOD.
          </p>
        </div>

        <DepartmentReview hod={hod} />

        {message && (
          <p role="status" className="rounded-md bg-mint px-3 py-2 font-semibold">
            {message}
          </p>
        )}
        {view?.error && <p className="font-semibold text-err">{view.error}</p>}
        {!view && <p className="text-ink-soft">Loading…</p>}

        {v && (
          <>
            <section aria-label="Waiting for you" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-xl font-bold">Waiting for you ({waiting.length})</h2>
                <button type="button" className="btn-quiet !py-1" onClick={load}>
                  Refresh
                </button>
              </div>
              {waiting.length === 0 ? (
                <p className="text-ink-soft">Nothing to approve right now.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {waiting.map((lv) => (
                    <Request key={lv.id} lv={lv} hod={hod} data={data} onDone={(m) => { setMessage(m); load(); }} />
                  ))}
                </ul>
              )}
            </section>
            {decided.length > 0 && (
              <details className="flex flex-col gap-3">
                <summary className="cursor-pointer text-xl font-bold">Decided ({decided.length})</summary>
                <ul className="mt-3 flex flex-col gap-3">
                  {decided.map((lv) => (
                    <Request key={lv.id} lv={lv} hod={hod} data={data} onDone={setMessage} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <HodCover hod={hod} data={data} />
        <HodRequests hod={hod} data={data} />

        {/* Department setup, in-charge and room sharing (components/department/*). */}
        <section className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
          <h2 className="text-xl font-bold">{hod.department_name} setup</h2>
          <p className="hint">Enter or check your department&apos;s rooms, teachers, sections and subjects, and mark it ready.</p>
          <Link href="/department" className="btn-primary w-fit">
            Open {hod.department_name} setup
          </Link>
        </section>
        <InchargeLink
          staff={{ member: hod }}
          dept={hod.department_id}
          teachers={(data?.teachers ?? [])
            .filter((t) => t.department_id === hod.department_id)
            .map((t) => ({ id: t.id, name: t.name || t.id }))}
        />
        <RoomSharing staff={{ member: hod }} dept={hod.department_id} data={data} canDecide />

        <button
          type="button"
          className="w-fit text-sm font-semibold text-navy underline"
          onClick={() => window.confirm("Forget your HOD link on this device?") && setMemberAccess("hod", null)}
        >
          Forget this link on this device
        </button>
      </main>
    </>
  );
}
