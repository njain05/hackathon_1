"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  adminFromHash,
  adminLink,
  createCollege,
  getAdminCollege,
  readAdminAccess,
  readSyncedAt,
  readSyncedStamp,
  saveDraft,
  setAdminAccess,
  shareLink,
  useAdminAccess,
  writeSyncedAt,
  type AdminAccess,
} from "@/lib/cloud";
import type { CollegeData } from "@/lib/types";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** JSON with sorted keys, so two copies of the same data compare equal. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
}

export function CopyField({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState<"no" | "yes" | "blocked">("no");
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("yes");
      setTimeout(() => setCopied("no"), 2000);
    } catch {
      // Clipboard blocked (some browsers, in-app viewers): select it and say how to copy.
      ref.current?.focus();
      ref.current?.select();
      setCopied("blocked");
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          ref={ref}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`field min-w-0 flex-1 ${big ? "!text-2xl font-bold tracking-widest" : ""}`}
        />
        <button type="button" className="btn-quiet shrink-0" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied === "yes" ? "Copied" : "Copy"}
        </button>
      </div>
      {copied === "blocked" && (
        <p role="status" className="hint">
          This browser blocked copying. The text is selected: press Ctrl+C (or long-press and choose Copy).
        </p>
      )}
    </div>
  );
}

/** The admin link (secret) and the share link + code (public). */
function LinksCard({ access, justCreated, onClose }: { access: AdminAccess; justCreated: boolean; onClose: () => void }) {
  return (
    <section aria-label="Your links" className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4">
      <div className="flex flex-col gap-3 rounded-md border-2 border-err/40 bg-blush p-3">
        <p className="text-lg font-bold">Save this link, it is your password.</p>
        <p className="text-sm">
          It is the only way back into this college’s setup, from this or any other device. Anyone who has it can change
          your timetable, so keep it private: save it in your notes or email it to yourself.
        </p>
        <CopyField label="Your admin link (secret)" value={adminLink(access)} />
      </div>
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <CopyField label="Share link for students and teachers" value={shareLink(access)} />
        <CopyField label="College code" value={access.code} big />
      </div>
      <p className="hint">
        Students and teachers open the share link, or type the code on the My timetable page. They see the timetable
        once you press <strong>Publish timetable</strong> on the Timetables page. They can never change anything.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={onClose}>
          {justCreated ? "I’ve saved my admin link" : "Close"}
        </button>
        {!justCreated && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              if (
                window.confirm(
                  "Stop saving to this college from this browser? The college stays online. You can get back in with your admin link.",
                )
              )
                setAdminAccess(null);
            }}
          >
            Disconnect this browser
          </button>
        )}
      </div>
    </section>
  );
}

type SaveState =
  | { kind: "checking" }
  | { kind: "conflict"; online: CollegeData; at: string | null }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  /** `afterSave`: a save failed after a good check, so the next edit may try again. */
  | { kind: "error"; message: string; afterSave: boolean };

/**
 * The "Save online & share" bar in the setup. Once the college is online, the
 * draft autosaves to the server a moment after each change.
 */
export function CloudSave({ data, replaceData }: { data: CollegeData; replaceData: (d: CollegeData) => void }) {
  const access = useAdminAccess();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState<"closed" | "open" | "new">("closed");
  const [save, setSave] = useState<SaveState>({ kind: "checking" });
  const lastSaved = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);

  // On opening (or connecting), compare with the copy online before autosaving,
  // so an old draft in this browser never overwrites newer work from another device.
  const code = access?.code;
  const key = access?.key;
  useEffect(() => {
    lastSaved.current = null; // a different college: nothing of ours is online yet
  }, [code]);
  useEffect(() => {
    if (!code || !key) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the online copy loads
    setSave({ kind: "checking" });
    getAdminCollege({ code, key })
      .then((c) => {
        if (!live) return;
        const online = c.data ? stable(c.data) : null;
        const mine = stable(data);
        const changedElsewhere = !c.data_updated_at || Date.parse(c.data_updated_at) !== readSyncedAt(code);
        // Changed online since this browser last saved it (another device): ask.
        if (c.data && online !== mine && online !== lastSaved.current && changedElsewhere) {
          setSave({ kind: "conflict", online: c.data, at: c.data_updated_at });
          return;
        }
        lastSaved.current = online;
        if (online === mine && c.data_updated_at) writeSyncedAt(code, c.data_updated_at);
        // Same as here: done. Otherwise autosave uploads this browser's newer copy.
        setSave(online === mine && c.data_updated_at ? { kind: "saved", at: c.data_updated_at } : { kind: "saving" });
      })
      .catch((e: unknown) => live && setSave({ kind: "error", message: errorText(e, "Couldn't reach the online copy."), afterSave: false }));
    return () => {
      live = false;
    };
    // Only when the college changes (or on Try again), not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, key, retry]);

  // Autosave a moment after the last change.
  const ready = save.kind === "saved" || save.kind === "saving" || (save.kind === "error" && save.afterSave);
  useEffect(() => {
    if (!access || !ready) return;
    const json = stable(data);
    if (json === lastSaved.current) return;
    const timer = setTimeout(() => {
      setSave({ kind: "saving" });
      saveDraft(access, data, readSyncedStamp(access.code))
        .then((r) => {
          lastSaved.current = json;
          writeSyncedAt(access.code, r.updated_at);
          setSave({ kind: "saved", at: r.updated_at });
        })
        .catch((e: unknown) => {
          // Someone saved online meanwhile (a department, another device): compare and ask, never overwrite.
          if (e instanceof ApiError && e.cause === 409) {
            setRetry((r) => r + 1);
            return;
          }
          setSave({ kind: "error", message: errorText(e, "Couldn't save online."), afterSave: true });
        });
    }, 1200);
    return () => clearTimeout(timer);
  }, [access, data, ready]);

  if (access === undefined) return null;

  if (!access) {
    const create = async () => {
      setCreating(true);
      setCreateError(null);
      try {
        const c = await createCollege(data.name, data);
        lastSaved.current = stable(data);
        setAdminAccess({ code: c.code, slug: c.slug, name: c.name, key: c.admin_key });
        setShowLinks("new");
      } catch (e) {
        setCreateError(errorText(e, "Couldn't save online. Try again."));
      } finally {
        setCreating(false);
      }
    };
    return (
      <div className="border-y border-line bg-paper px-4 py-3 sm:px-6 print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
          <p className="mr-auto">
            <span className="font-semibold">Saved only in this browser.</span>{" "}
            <span className="text-ink-soft">Save it online to work from another device and share the timetable with everyone.</span>
          </p>
          <button type="button" className="btn-primary" disabled={creating} onClick={create}>
            {creating ? "Saving online…" : "Save online & share"}
          </button>
          {createError && <p className="w-full font-semibold text-err">{createError}</p>}
        </div>
      </div>
    );
  }

  const status =
    save.kind === "checking"
      ? "Checking the online copy…"
      : save.kind === "saving"
        ? "Saving online…"
        : save.kind === "saved"
          ? `Saved online ${when(save.at)}`
          : save.kind === "error"
            ? save.message
            : "";

  return (
    <div className="border-y border-line bg-paper px-4 py-3 sm:px-6 print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="mr-auto">
            {/* Only problems are announced to screen readers, not every autosave. */}
            <span
              role={save.kind === "error" ? "alert" : undefined}
              className={`font-semibold ${save.kind === "error" ? "text-err" : save.kind === "saved" ? "text-ok" : ""}`}
            >
              {status}
            </span>{" "}
            <span className="text-ink-soft">College code {access.code}</span>
          </p>
          {save.kind === "error" && (
            <button type="button" className="btn-quiet" onClick={() => setRetry((r) => r + 1)}>
              Try again
            </button>
          )}
          {showLinks === "closed" && (
            <button type="button" className="btn-quiet" onClick={() => setShowLinks("open")}>
              Share links
            </button>
          )}
          <Link href="/approvals" className="btn-quiet">
            Hall booking approvals
          </Link>
        </div>

        {save.kind === "conflict" && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-line bg-blush p-3">
            <p className="font-semibold">
              Someone saved changes online since this browser last saved (a department, or you on another device)
              {save.at ? `, at ${when(save.at)}` : ""}. Nothing was overwritten. Which copy do you want to keep?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  lastSaved.current = stable(save.online);
                  if (save.at) writeSyncedAt(access.code, save.at);
                  replaceData(save.online);
                  setSave({ kind: "saved", at: save.at ?? new Date().toISOString() });
                }}
              >
                Use the online copy
              </button>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => {
                  lastSaved.current = stable(save.online);
                  // Saving over the online copy is now a choice made with it in view.
                  if (save.at) writeSyncedAt(access.code, save.at);
                  setSave({ kind: "saving" }); // autosave now uploads this browser's copy
                }}
              >
                Keep this browser’s copy (replaces theirs)
              </button>
            </div>
          </div>
        )}

        {showLinks !== "closed" && (
          <LinksCard access={access} justCreated={showLinks === "new"} onClose={() => setShowLinks("closed")} />
        )}
      </div>
    </div>
  );
}

export type OpenLinkState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "opened"; name: string };

/**
 * Opening the admin link (/setup#college=…&key=…): check the key, remember it
 * in this browser, load the saved setup, then take the key out of the address bar.
 */
export function useOpenAdminLink(loaded: boolean, hasData: boolean, replaceData: (d: CollegeData) => void): OpenLinkState {
  const [state, setState] = useState<OpenLinkState>({ kind: "idle" });
  // The link may also be pasted while /setup is already open: read the latest draft state then.
  const latest = useRef({ hasData, replaceData });
  useEffect(() => {
    latest.current = { hasData, replaceData };
  });
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    const open = () => {
      const link = adminFromHash(window.location.hash);
      if (!link) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setState({ kind: "loading" });
      getAdminCollege(link)
        .then((c) => {
          if (!live) return;
          const before = readAdminAccess();
          setAdminAccess({ code: c.code, slug: c.slug, name: c.name, key: link.key });
          // An empty browser takes the online copy. If this browser already has a
          // different setup, CloudSave asks which one to keep.
          if (c.data && (!latest.current.hasData || before?.code === c.code)) latest.current.replaceData(c.data);
          setState({ kind: "opened", name: c.name });
        })
        .catch((e: unknown) => live && setState({ kind: "error", message: errorText(e, "Couldn't open this admin link.") }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => {
      live = false;
      window.removeEventListener("hashchange", open);
    };
  }, [loaded]);
  return state;
}

export function AdminLinkNotice({ state, onClose }: { state: OpenLinkState; onClose: () => void }) {
  if (state.kind !== "error" && state.kind !== "opened") return null;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6 print:hidden ${state.kind === "error" ? "bg-blush" : "bg-mint"}`}>
      <p className="mr-auto">
        {state.kind === "error" ? (
          <span className="font-semibold text-err">{state.message}</span>
        ) : (
          <>
            <span className="font-semibold">Opened {state.name}.</span> This browser now saves to it automatically.
          </>
        )}
      </p>
      <button type="button" className="btn-quiet !py-1" onClick={onClose}>
        OK
      </button>
    </div>
  );
}
