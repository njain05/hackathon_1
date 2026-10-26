"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import {
  type Availability,
  bookableRooms,
  getAvailability,
  periodText,
  rememberBooking,
  requestBooking,
  todayIso,
  useMyBookings,
} from "@/lib/bookings";
import { setViewedCollege } from "@/lib/cloud";
import { useMemberAccess } from "@/lib/members";
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
      <div id="book-periods" tabIndex={-1} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" role="group" aria-label="Periods">
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
  const [showMissing, setShowMissing] = useState(false);

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

  const options = useMemo(() => (college.kind === "ready" ? bookableRooms(college.data) : []), [college]);
  const rooms = useMemo(() => options.map((o) => o.room), [options]);
  // A teacher's link on this device: the request goes to their HOD, then the Dean (else, a club's: to the Dean).
  const teacherLink = useMemberAccess("teacher");

  if (college.kind === "loading") return <p className="p-8 text-ink-soft">Loading…</p>;
  if (college.kind === "none") return <CollegeNeeded title="Book a room" error={college.error} />;
  const teacher = teacherLink && teacherLink.college_code === college.college.code ? teacherLink : null;

  const { data } = college;
  const room = rooms.find((r) => r.id === roomId);
  const current = slots?.key === key ? slots : null;
  const start = range.key === key ? range.start : null;
  const end = range.key === key ? range.end : null;
  const attendees = Number(form.attendees);
  const tooMany = room && attendees > room.capacity;
  // What's still missing, in order, with the field to jump to.
  const missing: { id: string; text: string }[] = [
    ...(!room ? [{ id: "book-room", text: "Choose a hall." }] : []),
    ...(!date ? [{ id: "book-date", text: "Choose a date." }] : []),
    ...(room && date && (start === null || end === null) ? [{ id: "book-periods", text: "Tap the free periods you need." }] : []),
    ...(!form.title.trim() ? [{ id: "book-title", text: "Give the event a name." }] : []),
    ...(!(attendees >= 1) ? [{ id: "book-attendees", text: "Say how many people you expect." }] : []),
    ...(tooMany ? [{ id: "book-attendees", text: `${room?.name || room?.id} seats only ${room?.capacity}. Choose a bigger hall or fewer people.` }] : []),
    ...(!form.organiser.trim() && !teacher ? [{ id: "book-organiser", text: "Add your name." }] : []),
    ...(!form.club.trim() && !teacher ? [{ id: "book-club", text: "Add your club or department." }] : []),
    ...(form.contact.trim().length < 3 ? [{ id: "book-contact", text: "Add a phone number or email." }] : []),
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length || start === null || end === null) {
      setShowMissing(true);
      const first = document.getElementById(missing[0]?.id ?? "");
      first?.focus();
      first?.scrollIntoView({ block: "center" });
      return;
    }
    setSending(true);
    setError(null);
    try {
      const b = await requestBooking(college.college.code, {
        room_id: roomId, date, start_period: start, end_period: end, title: form.title.trim(), purpose: form.purpose.trim(),
        attendees, organiser: form.organiser.trim() || teacher?.name || "", club: form.club.trim() || teacher?.department_name || "",
        contact: form.contact.trim(),
      }, teacher);
      rememberBooking(b);
      router.push(`/track/${encodeURIComponent(b.token)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request. Try again.");
      // Someone else just took one of these periods: show the latest free ones. Otherwise keep the choice.
      if (err instanceof ApiError && err.cause === 409) {
        setReload((r) => r + 1);
        setRange({ key: "", start: null, end: null });
      }
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
          <h1 className="text-2xl font-bold sm:text-3xl">Book a room</h1>
          <p className="text-ink-soft">
            Pick a hall or any room and a date, choose free periods, and send your request.{" "}
            {teacher
              ? `As ${teacher.name}, it goes to your HOD, then the Dean.`
              : "A student club’s request goes to the Dean. (Teachers: book from your teacher page so it goes to your HOD first.)"}{" "}
            Follow it with your tracking link. No letters needed.{" "}
            <Link href="/events" className="font-semibold text-navy underline">
              See the events calendar
            </Link>
          </p>
        </div>

        {rooms.length === 0 ? (
          <p className="rounded-md border border-line bg-paper p-4">
            {college.college.name} has no rooms in its published timetable yet.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-lg font-bold">1. Which room?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map(({ room: r, kind }) => (
                  <label
                    key={r.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${roomId === r.id ? "border-navy bg-sky/30" : "border-line bg-paper hover:bg-blush"}`}
                  >
                    <input type="radio" name="room" id={r.id === rooms[0]?.id ? "book-room" : undefined} value={r.id} checked={roomId === r.id} onChange={() => setRoomId(r.id)} />
                    <span>
                      <span className="block font-semibold">{r.name || r.id}</span>
                      <span className="text-sm text-ink-soft">
                        {kind} · seats {r.capacity}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-lg font-bold">2. Which day and periods?</legend>
              <label className="flex flex-col gap-1">
                <span className="field-label">Date</span>
                <input id="book-date" type="date" className="field w-fit" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
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
                <input id="book-title" className="field" maxLength={200} placeholder="e.g. Inter-college coding contest" {...field("title")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="field-label">Purpose (optional)</span>
                <textarea className="field min-h-20" maxLength={2000} placeholder="What happens, who is invited, any equipment needed" {...field("purpose")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="field-label">Expected attendees{room ? ` (${room.name || room.id} seats ${room.capacity})` : ""}</span>
                <input
                  id="book-attendees"
                  className="field w-40"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={form.attendees}
                  // Digits only: no scroll-wheel surprises and no "e" as in a number box.
                  onChange={(e) => setForm({ ...form, attendees: e.target.value.replace(/\D/g, "") })}
                />
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
                  <input id="book-organiser" className="field" maxLength={120} autoComplete="name" placeholder={teacher?.name} {...field("organiser")} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="field-label">Club or department</span>
                  <input id="book-club" className="field" maxLength={120} placeholder={teacher?.department_name ?? "e.g. Coding Club"} {...field("club")} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="field-label">Phone or email</span>
                  <input id="book-contact" className="field" maxLength={120} placeholder="Phone or email" {...field("contact")} />
                </label>
              </div>
              <p className="hint">Only the approvers see your phone or email, so they can reach you about the booking.</p>
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="btn-primary !px-5 !py-3 !text-base" disabled={sending}>
                {sending ? "Sending…" : "Send booking request"}
              </button>

            </div>
            {showMissing && missing.length > 0 && (
              <div role="alert" className="rounded-md bg-blush p-3">
                <p className="font-semibold">Before sending:</p>
                <ul className="list-disc pl-5">
                  {missing.map((m, i) => (
                    <li key={i}>
                      <button type="button" className="text-left underline" onClick={() => document.getElementById(m.id)?.focus()}>
                        {m.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
