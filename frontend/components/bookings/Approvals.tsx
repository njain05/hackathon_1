"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { CopyField } from "@/components/share/CloudSave";
import { ApiError } from "@/lib/api";
import {
  type ApprovalsView,
  type ApproverAuth,
  type Booking,
  approverFromHash,
  decideBooking,
  getApprovals,
  setApproverAccess,
  useApproverAccess,
} from "@/lib/bookings";
import { getPublished, useAdminAccess } from "@/lib/cloud";
import type { CollegeData } from "@/lib/types";
import { BookingFacts, History, StatusBadge, StepsTrail, whereItIs } from "./common";
import PageLoading from "@/components/ui/PageLoading";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** One request, with Approve / Reject when it's this person's turn. */
export function RequestCard({ b, data, auth, canAct, onDone }: {
  b: Booking;
  data: CollegeData | null;
  auth: ApproverAuth;
  canAct: boolean;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "approve" | "reject") => {
    if (action === "reject" && !note.trim() && !window.confirm("Reject without a note? The organiser won't see why.")) return;
    setBusy(true);
    setError(null);
    try {
      const after = await decideBooking(auth, b.id, action, note, name);
      onDone(
        action === "reject"
          ? `Rejected “${b.title}”. The organiser can see your note on their tracking page.`
          : after.status === "approved"
            ? `Approved “${b.title}”. The room is booked and it is on the events calendar.`
            : `Approved “${b.title}”. It now goes to the ${after.waiting_for}.`,
      );
    } catch (e) {
      setError(errorText(e, "Couldn't save your decision. Try again."));
      setBusy(false);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-lg font-bold">{b.title}</h3>
        <StatusBadge status={b.status} />
      </header>
      <p className="font-semibold">{whereItIs(b)}</p>
      <StepsTrail b={b} />
      <BookingFacts b={b} data={data} />
      <History b={b} />
      {canAct && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <label className="flex flex-col gap-1">
              <span className="field-label">Note for the organiser (optional)</span>
              <textarea className="field min-h-16" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please keep the hall clean" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="field-label">Your name (optional)</span>
              <input className="field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => act("approve")}>
              Approve
            </button>
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => act("reject")}>
              Reject
            </button>
          </div>
          {error && <p className="font-semibold text-err">{error}</p>}
        </div>
      )}
    </article>
  );
}

export default function Approvals() {
  const admin = useAdminAccess();
  const approver = useApproverAccess();
  const [opened, setOpened] = useState<{ error: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [choice, setChoice] = useState<"admin" | "approver" | null>(null);
  const [view, setView] = useState<{ for: string; value: ApprovalsView | null; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<CollegeData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // New requests may arrive while the page is open in another tab: check again when it is shown.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setReload((r) => r + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Opening an approver's link (/approvals#college=…&step=…&key=…): check it, keep it in this browser.
  // Also when a link is opened while this page is already showing (only the #… part changes).
  useEffect(() => {
    const open = () => {
      const link = approverFromHash(window.location.hash);
      if (!link) return;
      window.history.replaceState(null, "", window.location.pathname);
      setOpening(true);
      setOpened(null);
      getApprovals({ code: link.code, key: link.key })
        .then((v) => {
          setApproverAccess({ code: link.code, key: link.key, step: v.you?.title ?? link.step });
          setChoice("approver");
        })
        .catch((e: unknown) => setOpened({ error: errorText(e, "Couldn't open this approval link.") }))
        .finally(() => setOpening(false));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  const mode = choice ?? (admin ? "admin" : approver ? "approver" : null);
  const auth: ApproverAuth | null =
    mode === "admin" && admin ? { admin } : mode === "approver" && approver ? { code: approver.code, key: approver.key } : null;
  const authKey = auth ? JSON.stringify(auth) : "";
  const code = auth ? ("admin" in auth ? auth.admin.code : auth.code) : null;

  useEffect(() => {
    if (!auth) return;
    let live = true;
    getApprovals(auth)
      .then((v) => live && setView({ for: authKey, value: v, error: null }))
      .catch((e: unknown) => live && setView({ for: authKey, value: null, error: errorText(e, "Couldn't load the requests.") }));
    return () => {
      live = false;
    };
    // authKey stands for auth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey, reload]);

  useEffect(() => {
    if (!code) return;
    getPublished(code)
      .then((t) => setData(t.data))
      .catch(() => undefined);
  }, [code]);

  if (admin === undefined || approver === undefined || opening) return <PageLoading />;

  if (!auth)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Booking approvals</h1>
          {opened && <p className="text-lg font-semibold text-err">{opened.error}</p>}
          <p className="text-lg text-ink-soft">
            HODs: your requests are on your HOD page. The Dean: open the Dean’s link
            first, then come back here.
          </p>
          <Link href="/book" className="btn-quiet w-fit">
            Book a room instead
          </Link>
        </main>
      </>
    );

  const current = view?.for === authKey ? view : null;
  const reloadView = () => setReload((r) => r + 1);
  const decided = (m: string) => {
    setMessage(m);
    reloadView();
  };
  const v = current?.value;
  const you = v?.you ?? null;
  const pending = (v?.bookings ?? []).filter((b) => b.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const mine = pending.filter((b) => mode === "admin" || b.waiting_for === you?.title);
  const others = pending.filter((b) => !mine.includes(b));
  const done = (v?.bookings ?? []).filter((b) => b.status !== "pending").slice(0, 30);
  const bookLink = typeof window === "undefined" || !code ? "" : `${window.location.origin}/book?college=${encodeURIComponent(code)}`;

  return (
    <>
      <AppNav collegeName={data?.name ?? v?.bookings[0]?.college_name} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold sm:text-3xl">Booking approvals</h1>
          <p className="text-ink-soft">
            {mode === "admin"
              ? "You’re the Dean: you see every request and can approve or reject at any step."
              : you
                ? `You approve as ${you.title} (step ${you.position + 1} of ${v?.steps.length ?? 1}). ${
                    you.position === 0 ? "New requests come to you first." : `Requests reach you once ${v?.steps[you.position - 1]?.title} has approved.`
                  }`
                : ""}
          </p>
          {admin && approver && (
            <div role="group" aria-label="Act as" className="flex w-fit rounded-md border border-line bg-paper p-1">
              {(["admin", "approver"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setChoice(m)}
                  className={`rounded px-3 py-1.5 text-sm font-semibold ${mode === m ? "bg-sky/50" : "hover:bg-blush"}`}
                >
                  {m === "admin" ? "As Dean" : `As ${approver.step || "approver"}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {current?.error && (
          <div role="alert" className="flex flex-col gap-2 rounded-md bg-blush p-3">
            <p className="font-semibold text-err">{current.error}</p>
            {mode === "approver" && (
              <button type="button" className="btn-quiet w-fit" onClick={() => setApproverAccess(null)}>
                Forget this link on this device
              </button>
            )}
          </div>
        )}
        {!current && <p className="text-ink-soft">Loading requests…</p>}

        {v && mode === "admin" && admin && (
          <>
            <section className="flex flex-col gap-1 rounded-md border border-line bg-paper p-4" aria-label="Who approves">
              <h2 className="text-lg font-bold">Who approves</h2>
              <p className="text-ink-soft">
                A teacher’s request goes to the HOD of their department first, then to you. A student club’s request
                comes straight to you. You can approve or reject at any step.
              </p>
            </section>
            <section className="rounded-md border border-line bg-paper p-4">
              <CopyField label="Booking link for student clubs and societies (teachers book from their own page)" value={bookLink} />
            </section>
          </>
        )}

        {v && (
          <>
            {message && (
              <p role="status" className="rounded-md bg-mint px-3 py-2 font-semibold">
                {message}
              </p>
            )}
            <section className="flex flex-col gap-3" aria-label="Waiting for you">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-xl font-bold">
                  Waiting for {mode === "admin" ? "a decision" : "you"} ({mine.length})
                </h2>
                <button type="button" className="btn-quiet !py-1" onClick={reloadView}>
                  Refresh
                </button>
              </div>
              {mine.length === 0 ? (
                <p className="text-ink-soft">Nothing to approve right now.</p>
              ) : (
                mine.map((b) => <RequestCard key={b.id} b={b} data={data} auth={auth} canAct onDone={decided} />)
              )}
            </section>
            {others.length > 0 && (
              <section className="flex flex-col gap-3" aria-label="With other approvers">
                <h2 className="text-xl font-bold">With other approvers ({others.length})</h2>
                {others.map((b) => <RequestCard key={b.id} b={b} data={data} auth={auth} canAct={false} onDone={decided} />)}
              </section>
            )}
            {done.length > 0 && (
              <details className="flex flex-col gap-3">
                <summary className="cursor-pointer text-xl font-bold">Decided ({done.length})</summary>
                <div className="mt-3 flex flex-col gap-3">
                  {done.map((b) => <RequestCard key={b.id} b={b} data={data} auth={auth} canAct={false} onDone={decided} />)}
                </div>
              </details>
            )}
          </>
        )}
      </main>
    </>
  );
}
