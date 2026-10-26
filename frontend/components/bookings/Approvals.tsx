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
  type Step,
  approverFromHash,
  approverLink,
  decideBooking,
  getApprovals,
  newApproverLink,
  saveApproverLink,
  setApprovalSteps,
  setApproverAccess,
  useApproverAccess,
  useSavedApproverLinks,
} from "@/lib/bookings";
import { type AdminAccess, getPublished, useAdminAccess } from "@/lib/cloud";
import type { CollegeData } from "@/lib/types";
import { BookingFacts, History, StatusBadge, StepsTrail, whereItIs } from "./common";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** One request, with Approve / Reject when it's this person's turn. */
function RequestCard({ b, data, auth, canAct, onDone }: {
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
            ? `Approved “${b.title}”. The hall is booked and it is on the events calendar.`
            : `Approved “${b.title}”. It now goes to ${after.waiting_for}.`,
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

/** Admin: who approves, in order, and each approver's secret link. */
function ChainEditor({ admin, steps, onSaved }: { admin: AdminAccess; steps: Step[]; onSaved: () => void }) {
  const isDefault = steps.length === 1 && steps[0].id === null;
  const [rows, setRows] = useState(isDefault ? [] : steps.map((s) => ({ id: s.id, title: s.title })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = useSavedApproverLinks(admin.code);
  const changed = JSON.stringify(rows) !== JSON.stringify(isDefault ? [] : steps.map((s) => ({ id: s.id, title: s.title })));

  const keep = (s: Step) => {
    if (s.id !== null && s.key) saveApproverLink(admin.code, s.id, approverLink(admin.code, s, s.key));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await setApprovalSteps(admin, rows.map((r) => ({ id: r.id, title: r.title.trim() })));
      out.forEach(keep);
      onSaved();
    } catch (e) {
      setError(errorText(e, "Couldn't save the approval steps."));
    } finally {
      setBusy(false);
    }
  };

  const makeLink = async (s: Step) => {
    if (links[String(s.id)] && !window.confirm(`Make a new link for ${s.title}? Their old link will stop working.`)) return;
    try {
      keep(await newApproverLink(admin, s.id!));
    } catch (e) {
      setError(errorText(e, "Couldn't make a new link."));
    }
  };

  const move = (i: number, by: number) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setRows(next);
  };

  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4" aria-label="Approval steps">
      <div>
        <h2 className="text-lg font-bold">Who approves, in order</h2>
        <p className="text-ink-soft">
          {isDefault && rows.length === 0
            ? "Right now you (the admin) approve every request yourself. Add steps such as HOD, then Dean, to send each request through them one by one."
            : "Each request goes to the first step, then the next. Every approver gets a private link to approve from their own phone."}
        </p>
      </div>
      {rows.length > 0 && (
        <ol className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={r.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-6 font-semibold">{i + 1}.</span>
              <input
                className="field min-w-0 flex-1"
                aria-label={`Step ${i + 1} title`}
                maxLength={80}
                placeholder="e.g. HOD"
                value={r.title}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              <button type="button" className="btn-quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>
                ↑
              </button>
              <button type="button" className="btn-quiet" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>
                ↓
              </button>
              <button type="button" className="btn-quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-quiet" disabled={rows.length >= 5} onClick={() => setRows([...rows, { id: null, title: "" }])}>
          Add a step
        </button>
        {changed && (
          <button type="button" className="btn-primary" disabled={busy || rows.length === 0 || rows.some((r) => !r.title.trim())} onClick={save}>
            {busy ? "Saving…" : "Save steps"}
          </button>
        )}
        {changed && rows.length === 0 && <span className="hint">Keep at least one step.</span>}
      </div>

      {!isDefault && !changed && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <p className="font-semibold">Send each approver their own link</p>
          {steps.map((s) =>
            links[String(s.id)] ? (
              <div key={s.id} className="flex flex-col gap-1">
                <CopyField label={`${s.title}’s approval link (private)`} value={links[String(s.id)]} />
                <button type="button" className="w-fit text-sm font-semibold text-navy underline" onClick={() => makeLink(s)}>
                  Make a new link for {s.title}
                </button>
              </div>
            ) : (
              <div key={s.id} className="flex flex-wrap items-center gap-3">
                <span>
                  <span className="font-semibold">{s.title}:</span>{" "}
                  <span className="text-ink-soft">the link was made on another device.</span>
                </span>
                <button type="button" className="btn-quiet" onClick={() => makeLink(s)}>
                  Make a new link
                </button>
              </div>
            ),
          )}
        </div>
      )}
      {error && <p className="font-semibold text-err">{error}</p>}
    </section>
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

  if (admin === undefined || approver === undefined || opening) return <p className="p-8 text-ink-soft">Loading…</p>;

  if (!auth)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Booking approvals</h1>
          {opened && <p className="text-lg font-semibold text-err">{opened.error}</p>}
          <p className="text-lg text-ink-soft">
            Approvers: open the private approval link the timetable in-charge sent you. Admins: open your admin link
            first, then come back here.
          </p>
          <Link href="/book" className="btn-quiet w-fit">
            Book a hall instead
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
              ? "You’re the admin: you can approve or reject at any step."
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
                  {m === "admin" ? "As admin" : `As ${approver.step || "approver"}`}
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
            <ChainEditor key={JSON.stringify(v.steps)} admin={admin} steps={v.steps} onSaved={reloadView} />
            <section className="rounded-md border border-line bg-paper p-4">
              <CopyField label="Booking link for organisers (clubs, societies, departments)" value={bookLink} />
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
