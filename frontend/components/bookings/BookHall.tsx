"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import {
  type Availability,
  eventRooms,
  getAvailability,
  periodText,
  rememberBooking,
  requestBooking,
  todayIso,
  useMyBookings,
} from "@/lib/bookings";
import { setViewedCollege } from "@/lib/cloud";
import { dayBlocks, formatTime } from "@/lib/periods";
import type { CollegeData } from "@/lib/types";
import { CollegeNeeded, usePublishedCollege } from "./common";

const REASON = { class: "Class", booked: "Booked", requested: "Requested" } as const;

function PeriodPicker({
  data,
  slots,
  start,
  end,
  onPick,
}: {
  data: CollegeData;
  slots: Availability;
  start: number | null;
  end: number | null;
  onPick: (start: number | null, end: number | null) => void;
}) {
  const times = dayBlocks(data.settings).filter((b) => b.kind === "period");
  const free = (p: number) => slots.periods.find((s) => s.period === p)?.free ?? false;
  const allFree = (a: number, b: number) => [...Array(b - a + 1)].every((_, i) => free(a + i));

  // Tap one period, then another to stretch the booking across the periods between.
  const pick = (p: number) => {
    if (start === null || end === null) return onPick(p, p);
    if (p === start && p === end) return onPick(null, null);
    if (p < start && allFree(p, end)) return onPick(p, end);
    if (p > end && allFree(start, p)) return onPick(start, p);
    onPick(p, p);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" role="group" aria-label="Periods">
        {slots.periods.map((s) => {
          const t = times[s.period - 1];
          const on = start !== null && end !== null && s.period >= start && s.period <= end;
          return (
            <button
              key={s.period}
              type="button"
              disabled={!s.free}
              aria-pressed={on}
              onClick={() => pick(s.period)}
              className={`flex flex-col rounded-md border px-2 py-2 text-left text-sm ${
                !s.free
                  ? "cursor-not-allowed border-line bg-blush/60 text-ink-soft"
                  : on
                    ? "border-navy bg-sky/50 font-semibold"
                    : "border-line bg-paper hover:bg-mint"
              }`}
            >
              <span className="font-semibold">Period {s.period}</span>
              {t && <span>{`${formatTime(t.start)}–${formatTime(t.end)}`}</span>}
              <span className="text-xs">{s.free ? (on ? "Selected" : "Free") : REASON[s.reason ?? "booked"]}</span>
            </button>
          );
        })}
      </div>
      <p className="hint">Tap a free period, then tap another to book everything between them.</p>
    </div>
  );
}

export default function BookHall() {
  const college = usePublishedCollege();
  const mine = useMyBookings();
  const router = useRouter();

  // A link like /book?college=K7M2QP opens that college on this device.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("college");
    if (code) setViewedCollege(code);
  }, []);

  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<{ key: string; value: Availability | null; error: string | null } | null>(null);
  const [range, setRange] = useState<{ key: string; start: number | null; end: number | null }>({ key: "", start: null, end: null });
  const [form, setForm] = useState({ title: "", purpose: "", attendees: "", organiser: "", club: "", contact: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const code = college.kind === "ready" ? college.college.code : null;
  const key = `${code}|${roomId}|${date}`;
  useEffect(() => {
    if (!code || !roomId || !date) return;
    let live = true;
    getAvailability(code, roomId, date)
      .then((v) => live && setSlots({ key, value: v, error: null }))
      .catch((e: unknown) => live && setSlots({ key, value: null, error: e instanceof ApiError ? e.message : "Couldn't load the free periods." }));
    return () => {
      live = false;
    };
  }, [code, roomId, date, key, reload]);

  const rooms = useMemo(() => (college.kind === "ready" ? eventRooms(college.data) : []), [college]);

  if (college.kind === "loading") return <p className="p-8 text-ink-soft">Loading…</p>;
  if (college.kind === "none") return <CollegeNeeded title="Book a hall" error={college.error} />;

  const { data } = college;
  const room = rooms.find((r) => r.id === roomId);
  const current = slots?.key === key ? slots : null;
  const start = range.key === key ? range.start : null;
  const end = range.key === key ? range.end : null;
  const attendees = Number(form.attendees);
  const tooMany = room && attendees > room.capacity;
  const ready =
    room && date && start !== null && end !== null && form.title.trim() && attendees >= 1 && !tooMany &&
    form.organiser.trim() && form.club.trim() && form.contact.trim().length >= 3;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || start === null || end === null) return;
    setSending(true);
    setError(null);
    try {
      const b = await requestBooking(college.college.code, {
        room_id: roomId, date, start_period: start, end_period: end, title: form.title.trim(), purpose: form.purpose.trim(),
        attendees, organiser: form.organiser.trim(), club: form.club.trim(), contact: form.contact.trim(),
      });
      rememberBooking(b);
      router.push(`/track/${encodeURIComponent(b.token)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request. Try again.");
      // Someone may have just taken the slot: show the latest free periods.
      setReload((r) => r + 1);
      setRange({ key: "", start: null, end: null });
      setSending(false);
    }
  };

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }),
  });

  return (
    <>
      <AppNav collegeName={college.college.name} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold sm:text-3xl">Book a hall</h1>
          <p className="text-ink-soft">
            Pick a hall and a date, choose free periods, and send your request. It goes to {college.college.name}’s
            approvers one by one, and you can follow it with your tracking link. No letters needed.{" "}
            <Link href="/events" className="font-semibold text-navy underline">
              See the events calendar
            </Link>
          </p>
        </div>

        {rooms.length === 0 ? (
          <p className="rounded-md border border-line bg-paper p-4">
            {college.college.name} has no seminar halls or auditoriums set up for bookings yet. The timetable in-charge can
            add one in the setup (a room whose type is used for events).
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-lg font-bold">1. Which hall?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {rooms.map((r) => (
                  <label
                    key={r.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${roomId === r.id ? "border-navy bg-sky/30" : "border-line bg-paper hover:bg-blush"}`}
                  >
                    <input type="radio" name="room" value={r.id} checked={roomId === r.id} onChange={() => setRoomId(r.id)} />
                    <span>
                      <span className="block font-semibold">{r.name || r.id}</span>
                      <span className="text-sm text-ink-soft">Seats {r.capacity}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-lg font-bold">2. Which day and periods?</legend>
              <label className="flex flex-col gap-1">
                <span className="field-label">Date</span>
                <input type="date" className="field w-fit" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              {!roomId || !date ? (
                <p className="hint">Choose a hall and a date to see its free periods.</p>
              ) : !current ? (
                <p className="hint">Checking which periods are free…</p>
              ) : current.error ? (
                <p className="font-semibold text-err">{current.error}</p>
              ) : current.value ? (
                <>
                  {current.value.day === null && (
                    <p className="hint">There are no classes on this day, so only other bookings can take a period.</p>
                  )}
                  <PeriodPicker
                    data={data}
                    slots={current.value}
                    start={start}
                    end={end}
                    onPick={(s, e) => setRange({ key, start: s, end: e })}
                  />
                  {start !== null && end !== null && (
                    <p className="font-semibold">Selected: {periodText(data, start, end)}</p>
                  )}
                </>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-lg font-bold">3. About the event</legend>
              <label className="flex flex-col gap-1">
                <span className="field-label">Event name</span>
                <input className="field" placeholder="e.g. Inter-college coding contest" {...field("title")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="field-label">Purpose (optional)</span>
                <textarea className="field min-h-20" placeholder="What happens, who is invited, any equipment needed" {...field("purpose")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="field-label">Expected attendees{room ? ` (${room.name || room.id} seats ${room.capacity})` : ""}</span>
                <input className="field w-40" type="number" min={1} inputMode="numeric" {...field("attendees")} />
                {tooMany && (
                  <span className="font-semibold text-err">
                    Too many for this hall. Choose a bigger one or lower the number.
                  </span>
                )}
              </label>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-lg font-bold">4. Who is organising?</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="field-label">Your name</span>
                  <input className="field" autoComplete="name" {...field("organiser")} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="field-label">Club or department</span>
                  <input className="field" placeholder="e.g. Coding Club" {...field("club")} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="field-label">Phone or email</span>
                  <input className="field" autoComplete="email" {...field("contact")} />
                </label>
              </div>
              <p className="hint">Only the approvers see your phone or email, so they can reach you about the booking.</p>
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="btn-primary !px-5 !py-3 !text-base" disabled={!ready || sending}>
                {sending ? "Sending…" : "Send booking request"}
              </button>
              {!ready && <span className="hint">Fill in every step above to send it.</span>}
            </div>
            {error && (
              <p role="alert" className="font-semibold text-err">
                {error}
              </p>
            )}
          </form>
        )}

        {mine && mine.length > 0 && (
          <section className="flex flex-col gap-2 border-t border-line pt-6">
            <h2 className="text-lg font-bold">Requests sent from this device</h2>
            <ul className="flex flex-col gap-1">
              {mine.map((m) => (
                <li key={m.token}>
                  <Link href={`/track/${encodeURIComponent(m.token)}`} className="font-semibold text-navy underline">
                    {m.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
