"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { type ApprovalsView, getApprovals } from "@/lib/bookings";
import type { MemberAccess } from "@/lib/members";
import type { CollegeData } from "@/lib/types";
import { RequestCard } from "./Approvals";

/** Room requests from the HOD's own teachers: the HOD approves first, then they go to the Dean. */
export default function HodRequests({ hod, data }: { hod: MemberAccess; data: CollegeData | null }) {
  const [view, setView] = useState<{ value: ApprovalsView | null; error: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const auth = { member: hod };

  const load = useCallback(() => {
    getApprovals({ member: hod })
      .then((v) => setView({ value: v, error: null }))
      .catch((e: unknown) => setView({ value: null, error: e instanceof ApiError ? e.message : "Couldn't load the requests." }));
  }, [hod]);

  useEffect(() => {
    load();
  }, [load]);

  const v = view?.value;
  const mine = v?.bookings.filter((b) => b.status === "pending" && b.waiting_for === v.you?.title) ?? [];
  const rest = v?.bookings.filter((b) => !mine.includes(b)).slice(0, 20) ?? [];

  return (
    <section aria-label="Room requests" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold">Room requests from your teachers ({mine.length})</h2>
        <button type="button" className="btn-quiet !py-1" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="text-ink-soft">You approve first; then each request goes to the Dean.</p>
      {message && (
        <p role="status" className="rounded-md bg-mint px-3 py-2 font-semibold">
          {message}
        </p>
      )}
      {view?.error && <p className="font-semibold text-err">{view.error}</p>}
      {!view && <p className="text-ink-soft">Loading…</p>}
      {v && mine.length === 0 && <p className="text-ink-soft">Nothing waiting for you.</p>}
      {mine.map((b) => (
        <RequestCard key={b.id} b={b} data={data} auth={auth} canAct onDone={(m) => { setMessage(m); load(); }} />
      ))}
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Earlier and with the Dean ({rest.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {rest.map((b) => (
              <RequestCard key={b.id} b={b} data={data} auth={auth} canAct={false} onDone={setMessage} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
