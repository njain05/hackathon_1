"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import { type CalendarEvent, dateText, getEvents, periodText, todayIso } from "@/lib/bookings";
import { CollegeNeeded, usePublishedCollege } from "./common";

/** Approved events by date, so two clubs don't pick the same day. */
export default function EventsCalendar() {
  const college = usePublishedCollege();
  const code = college.kind === "ready" ? college.college.code : null;
  const [events, setEvents] = useState<{ code: string; list: CalendarEvent[] | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!code) return;
    let live = true;
    getEvents(code, todayIso())
      .then((list) => live && setEvents({ code, list, error: null }))
      .catch((e: unknown) => live && setEvents({ code, list: null, error: e instanceof ApiError ? e.message : "Couldn't load the events." }));
    return () => {
      live = false;
    };
  }, [code]);

  if (college.kind === "loading") return <p className="p-8 text-ink-soft">Loading…</p>;
  if (college.kind === "none") return <CollegeNeeded title="Events calendar" error={college.error} />;

  const { data } = college;
  const current = events?.code === code ? events : null;
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of current?.list ?? []) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <>
      <AppNav collegeName={college.college.name} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Events calendar</h1>
            <p className="text-ink-soft">Approved events in {college.college.name}’s halls, from today on.</p>
          </div>
          <Link href="/book" className="btn-primary">
            Book a hall
          </Link>
        </div>

        {!current ? (
          <p className="text-ink-soft">Loading events…</p>
        ) : current.error ? (
          <p className="font-semibold text-err">{current.error}</p>
        ) : byDate.size === 0 ? (
          <p className="rounded-md border border-line bg-paper p-4 text-lg">
            No events are booked yet. Halls are free on every day that has no classes in them.
          </p>
        ) : (
          <ol className="flex flex-col gap-5">
            {[...byDate].map(([day, list]) => (
              <li key={day} className="flex flex-col gap-2">
                <h2 className="text-lg font-bold">{dateText(day)}</h2>
                <ul className="flex flex-col gap-2">
                  {list.map((e) => (
                    <li key={e.id} className="grid gap-1 rounded-md border border-line bg-paper p-3 sm:grid-cols-[14rem_1fr]">
                      <span className="font-semibold text-navy">{periodText(data, e.start_period, e.end_period)}</span>
                      <span>
                        <span className="font-semibold">{e.title}</span>
                        <span className="text-ink-soft">
                          {" "}
                          · {e.club} · {e.room_name}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
