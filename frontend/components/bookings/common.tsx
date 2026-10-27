"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";
import { CollegeCodeForm } from "@/components/share/OpenCollege";
import { ago, type Booking, dateText, periodText, STATUS_TEXT } from "@/lib/bookings";
import { type PublicTimetable, useAdminAccess, useViewerTimetable } from "@/lib/cloud";
import type { CollegeData } from "@/lib/types";

export type CollegeState =
  | { kind: "loading" }
  | { kind: "none"; error?: string }
  | { kind: "ready"; college: PublicTimetable; data: CollegeData };

/**
 * The college a booking page is about: the one opened on this device (share
 * link or code), else the admin's own. Uses its published timetable for the
 * halls and the clock times.
 */
export function usePublishedCollege(): CollegeState {
  const admin = useAdminAccess();
  const { state } = useViewerTimetable(null, admin === undefined ? undefined : (admin?.code ?? null));
  if (admin === undefined || state.kind === "loading") return { kind: "loading" };
  if (state.kind === "published") return { kind: "ready", college: state.college, data: state.college.data };
  return { kind: "none", error: state.kind === "none" ? state.error : undefined };
}

/** Shown when no college is open on this device yet. */
export function CollegeNeeded({ title, error }: { title: string; error?: string }) {
  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-5 px-4 py-16">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-lg text-ink-soft">
          Type your college code, or open the link your college shared. Rooms can be booked once the college has
          published its timetable.
        </p>
        <CollegeCodeForm error={error} />
        <p className="text-ink-soft">
          Running the timetable?{" "}
          <Link href="/setup" className="font-semibold text-navy underline">
            Go to setup
          </Link>
        </p>
      </main>
    </>
  );
}

const BADGE: Record<Booking["status"], string> = {
  pending: "bg-blush text-ink",
  approved: "bg-mint text-ok",
  rejected: "bg-blush text-err",
  cancelled: "bg-paper text-ink-soft border border-line",
};

export function StatusBadge({ status }: { status: Booking["status"] }) {
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${BADGE[status]}`}>{STATUS_TEXT[status]}</span>;
}

/** "Waiting for Dean, sent 2 hours ago", "Approved by Dean", "Not approved by HOD". */
export function whereItIs(b: Booking): string {
  if (b.status === "pending") return `Waiting for ${b.waiting_for}${b.waiting_since ? `, sent ${ago(b.waiting_since)}` : ""}`;
  const last = b.history[b.history.length - 1];
  if (b.status === "approved") return `Approved${last ? ` by ${last.step_title}` : ""}. The room is yours.`;
  if (b.status === "rejected") return `Not approved${last ? ` by ${last.step_title}` : ""}`;
  return "Cancelled by the organiser";
}

const STEP_STYLE: Record<Booking["steps"][number]["state"], string> = {
  approved: "border-ok/50 bg-mint",
  rejected: "border-err/50 bg-blush",
  waiting: "border-navy bg-sky/30 font-semibold",
  later: "border-line bg-paper text-ink-soft",
};

const STEP_MARK: Record<Booking["steps"][number]["state"], string> = {
  approved: "Approved",
  rejected: "Not approved",
  waiting: "Waiting",
  later: "Next",
};

/** The approval chain as a row of steps: who has signed, who is next. */
export function StepsTrail({ b }: { b: Booking }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Approval steps">
      <li className="rounded-md border border-ok/50 bg-mint px-3 py-1.5 text-sm">
        <span className="block text-xs text-ink-soft">Sent</span>
        {b.organiser}
      </li>
      {b.steps.filter((s) => b.status === "pending" || b.status === "approved" || s.state !== "later").map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span aria-hidden className="text-ink-soft">
            →
          </span>
          <span className={`rounded-md border px-3 py-1.5 text-sm ${STEP_STYLE[s.state]}`}>
            <span className="block text-xs text-ink-soft">{STEP_MARK[s.state]}</span>
            {s.title}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Hall, date, time, people: the facts of a request. */
export function BookingFacts({ b, data }: { b: Booking; data: CollegeData | null }) {
  const room = data?.rooms.find((r) => r.id === b.room_id);
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
      <dt className="font-semibold">Room</dt>
      <dd>
        {b.room_name}
        {room && <span className="text-ink-soft"> (seats {room.capacity})</span>}
      </dd>
      <dt className="font-semibold">When</dt>
      <dd>
        {dateText(b.date)}, {data ? periodText(data, b.start_period, b.end_period) : `periods ${b.start_period}–${b.end_period}`}
      </dd>
      <dt className="font-semibold">Expected</dt>
      <dd>{b.attendees} people</dd>
      <dt className="font-semibold">Organiser</dt>
      <dd>
        {b.organiser}, {b.club} ({b.contact})
      </dd>
      {b.purpose && (
        <>
          <dt className="font-semibold">Purpose</dt>
          <dd className="whitespace-pre-line">{b.purpose}</dd>
        </>
      )}
    </dl>
  );
}

/** Each signature: who, when, and their note. */
export function History({ b }: { b: Booking }) {
  if (!b.history.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {b.history.map((h, i) => (
        <li key={i} className="border-l-4 border-sky pl-3">
          <span className="font-semibold">
            {h.action === "approved" ? "Approved" : h.action === "rejected" ? "Not approved" : "Cancelled"}
          </span>{" "}
          by {h.by}, {new Date(h.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          {h.note && <p className="text-ink-soft">“{h.note}”</p>}
        </li>
      ))}
    </ul>
  );
}
