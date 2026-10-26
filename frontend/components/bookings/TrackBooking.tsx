"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { CopyField } from "@/components/share/CloudSave";
import { ApiError } from "@/lib/api";
import { type Booking, cancelBooking, rememberBooking, trackBooking, trackLink } from "@/lib/bookings";
import { getPublished } from "@/lib/cloud";
import type { CollegeData } from "@/lib/types";
import { BookingFacts, History, StatusBadge, StepsTrail, whereItIs } from "./common";

/** The organiser's tracking page: exactly where the request is, like a parcel. */
export default function TrackBooking({ token }: { token: string }) {
  const [b, setB] = useState<Booking | null>(null);
  const [data, setData] = useState<CollegeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    trackBooking(token)
      .then((x) => {
        setB(x);
        setError(null);
        rememberBooking(x);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Couldn't load this request."));
  }, [token]);

  useEffect(() => {
    load();
    // Check again whenever the organiser comes back to the page.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // The college's clock times, to show "11:40–13:20" rather than just period numbers.
  const code = b?.college_code;
  useEffect(() => {
    if (!code) return;
    getPublished(code)
      .then((t) => setData(t.data))
      .catch(() => undefined);
  }, [code]);

  if (!b)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          {error ? (
            <>
              <h1 className="text-3xl font-bold">Request not found</h1>
              <p className="text-lg text-err">{error}</p>
              <Link href="/book" className="btn-primary w-fit">
                Book a hall
              </Link>
            </>
          ) : (
            <p className="text-ink-soft">Loading your request…</p>
          )}
        </main>
      </>
    );

  const cancel = async () => {
    if (!window.confirm(b.status === "approved" ? "Cancel this event? The hall will be free for others." : "Withdraw this request?")) return;
    setBusy(true);
    try {
      setB(await cancelBooking(token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't cancel. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppNav collegeName={b.college_name} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink-soft">Hall booking request</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{b.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={b.status} />
            <span className="text-lg font-semibold" aria-live="polite">
              {whereItIs(b)}
            </span>
          </div>
        </div>

        <section className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4" aria-label="Approval progress">
          <StepsTrail b={b} />
          <History b={b} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Details</h2>
          <BookingFacts b={b} data={data} />
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
          <CopyField label="Your tracking link: save it to check on this request from any device" value={trackLink(b.token)} />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-quiet" onClick={load}>
            Refresh
          </button>
          {(b.status === "pending" || b.status === "approved") && (
            <button type="button" className="btn-quiet" disabled={busy} onClick={cancel}>
              {b.status === "approved" ? "Cancel the event" : "Withdraw request"}
            </button>
          )}
          {(b.status === "rejected" || b.status === "cancelled") && (
            <Link href="/book" className="btn-primary">
              Book another time
            </Link>
          )}
          {b.status === "approved" && (
            <Link href="/events" className="btn-quiet">
              See the events calendar
            </Link>
          )}
        </div>
        {error && <p className="font-semibold text-err">{error}</p>}
      </main>
    </>
  );
}
