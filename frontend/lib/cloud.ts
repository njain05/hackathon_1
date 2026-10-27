"use client";

// Save and share: the college on the server.
// - The admin's link (college code + secret key) is kept in this browser and
//   sent as X-Admin-Key on every write. The key only ever travels in the URL
//   fragment (#…), which browsers never send to a server.
// - Students and teachers open a college by its code or share link; the
//   published timetable is cached here so it still opens with no internet.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, call, toApi } from "./api";
import { readLocal, useLocal, writeLocal } from "./local";
import { useRefreshWhenShown } from "./refresh";
import type { StoredTimetable } from "./result";
import type { CollegeData, SolveResult } from "./types";

export interface CollegeInfo {
  name: string;
  slug: string;
  code: string;
  published_version: number | null;
  published_at: string | null;
}

export interface AdminCollege extends CollegeInfo {
  data: CollegeData | null;
  data_updated_at: string | null;
}

export interface PublicTimetable extends CollegeInfo {
  version: number;
  data: CollegeData;
  result: SolveResult;
}

/** This browser's admin access to one college. */
export interface AdminAccess {
  code: string;
  slug: string;
  name: string;
  key: string;
}

const ADMIN_KEY = "timetable.admin.v1";
const VIEW_KEY = "timetable.college.v1"; // the college code a student or teacher opened
const CACHE_KEY = "timetable.published.v1"; // their last downloaded published timetable
const LIVE_KEY = "timetable.live.v1"; // which generated timetable the admin last published
const SYNC_KEY = "timetable.synced.v1"; // when this browser last saved the draft online

const enc = encodeURIComponent;
const asAdmin = (a: AdminAccess) => ({ "X-Admin-Key": a.key });

// ---------- API ----------

export const createCollege = (name: string, data: CollegeData) =>
  call<CollegeInfo & { admin_key: string }>("/colleges", {
    method: "POST",
    body: JSON.stringify({ name: name.trim() || "My College", data }),
  });

export const getCollege = (ref: string) => call<CollegeInfo>(`/colleges/${enc(ref)}`);

export const getPublished = (ref: string) => call<PublicTimetable>(`/colleges/${enc(ref)}/timetable`);

export const getAdminCollege = (a: Pick<AdminAccess, "code" | "key">) =>
  call<AdminCollege>(`/colleges/${enc(a.code)}/admin`, { headers: { "X-Admin-Key": a.key } });

/** `basedOn`: the updated_at of the online copy this one started from. If someone saved since
 * (a department, another device), the server refuses with 409 instead of overwriting their work. */
export const saveDraft = (a: AdminAccess, d: CollegeData, basedOn?: string | null) =>
  call<{ updated_at: string }>(`/colleges/${enc(a.code)}/data`, {
    method: "PUT",
    headers: { ...asAdmin(a), ...(basedOn ? { "X-Based-On": basedOn } : {}) },
    body: JSON.stringify(d),
  });

export const publishTimetable = (a: AdminAccess, t: StoredTimetable) =>
  call<{ version: number; published_at: string }>(`/colleges/${enc(a.code)}/publish`, {
    method: "POST",
    headers: asAdmin(a),
    body: JSON.stringify({ data: toApi(t.data), result: t.result }),
  });

// ---------- Links ----------

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

/** The admin's secret link. Anyone holding it can change the college. */
export const adminLink = (a: AdminAccess) => `${origin()}/setup#college=${enc(a.code)}&key=${enc(a.key)}`;

/** The public link for students and teachers. Read-only. */
export const shareLink = (c: Pick<CollegeInfo, "slug">) => `${origin()}/c/${enc(c.slug)}`;

/** Reads `#college=…&key=…` from an admin link, or null. */
export function adminFromHash(hash: string): Pick<AdminAccess, "code" | "key"> | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const code = p.get("college")?.trim();
  const key = p.get("key")?.trim();
  return code && key ? { code, key } : null;
}

// ---------- Browser storage ----------

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The admin access saved in this browser: `undefined` while loading, `null` if none. */
export function useAdminAccess(): AdminAccess | null | undefined {
  const raw = useLocal(ADMIN_KEY);
  return useMemo(() => (raw === undefined ? undefined : parse<AdminAccess>(raw)), [raw]);
}

export const setAdminAccess = (a: AdminAccess | null) => writeLocal(ADMIN_KEY, a && JSON.stringify(a));
export const readAdminAccess = () => parse<AdminAccess>(readLocal(ADMIN_KEY));

/**
 * The server time of this browser's last save of `code`'s draft. If the online
 * copy still has that time, nobody else has changed it since.
 */
export function readSyncedAt(code: string): number | null {
  const s = parse<{ code: string; at: string }>(readLocal(SYNC_KEY));
  return s?.code === code ? Date.parse(s.at) : null;
}

/** The same time exactly as the server wrote it, to send back as X-Based-On. */
export function readSyncedStamp(code: string): string | null {
  const s = parse<{ code: string; at: string }>(readLocal(SYNC_KEY));
  return s?.code === code ? s.at : null;
}

export const writeSyncedAt = (code: string, at: string) => writeLocal(SYNC_KEY, JSON.stringify({ code, at }));

/** Which generated timetable (by its `at` time) is live for which college. */
export function useLiveMark(): { code: string; at: string; version: number; published_at: string } | null | undefined {
  const raw = useLocal(LIVE_KEY);
  return useMemo(() => (raw === undefined ? undefined : parse(raw)), [raw]);
}

export const setLiveMark = (m: { code: string; at: string; version: number; published_at: string }) =>
  writeLocal(LIVE_KEY, JSON.stringify(m));

export const clearLiveMark = () => writeLocal(LIVE_KEY, null);

/** Dean: take the timetable down; students and teachers see "not published yet" until the next publish. */
export const unpublishTimetable = (a: AdminAccess) =>
  call<null>(`/colleges/${enc(a.code)}/timetable`, { method: "DELETE", headers: asAdmin(a) });

/** Remember the college a student or teacher opened (null forgets it). */
export const setViewedCollege = (code: string | null) => writeLocal(VIEW_KEY, code);

interface CachedTimetable {
  code: string;
  fetched_at: string;
  timetable: PublicTimetable;
}

export type ViewerState =
  | { kind: "loading" }
  /** No college opened, and nothing generated in this browser. */
  | { kind: "none"; error?: string }
  /** The admin's own generated timetable, in this browser only. */
  | { kind: "local"; stored: StoredTimetable }
  | {
      kind: "published";
      stored: StoredTimetable;
      college: PublicTimetable;
      /** When this copy was downloaded; `stale` if the latest download failed. */
      fetchedAt: string;
      stale: boolean;
      error?: string;
    };

const sameCollege = (t: CollegeInfo, ref: string) => t.code === ref.toUpperCase() || t.slug === ref.toLowerCase();

/**
 * The timetable a student or teacher sees.
 * A college code (opened from a share link or typed in) means the published
 * timetable from the server, cached for offline use. Otherwise the timetable
 * generated in this browser (the admin's preview).
 */
export function useViewerTimetable(local: StoredTimetable | null | undefined, fallbackCode?: string | null) {
  const remembered = useLocal(VIEW_KEY);
  const rawCache = useLocal(CACHE_KEY);
  // `fallbackCode`: e.g. the admin's own college, when nothing was opened by code.
  const code = remembered ?? fallbackCode ?? null;
  const [fetched, setFetched] = useState<{ code: string; at: string; timetable: PublicTimetable | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!code) return;
    let live = true;
    getPublished(code)
      .then((t) => {
        if (!live) return;
        const at = new Date().toISOString();
        writeLocal(CACHE_KEY, JSON.stringify({ code: t.code, fetched_at: at, timetable: t } satisfies CachedTimetable));
        // Remember the college by its code, so a slug link and the code share one cache.
        if (readLocal(VIEW_KEY) !== t.code) setViewedCollege(t.code);
        setFetched({ code, at, timetable: t, error: null });
      })
      .catch((e: unknown) => {
        if (live) setFetched({ code, at: "", timetable: null, error: e instanceof ApiError ? e.message : "Couldn't load the timetable." });
      });
    return () => {
      live = false;
    };
  }, [code, tick]);

  // Refresh when the phone comes back online or the app is opened again.
  useEffect(() => {
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [refresh]);
  useRefreshWhenShown(refresh);

  const state = useMemo<ViewerState>(() => {
    if (local === undefined || remembered === undefined || rawCache === undefined) return { kind: "loading" };
    if (!code) return local ? { kind: "local", stored: local } : { kind: "none" };

    const done = fetched?.code === code ? fetched : null;
    const cache = parse<CachedTimetable>(rawCache);
    const copy = done?.timetable
      ? { timetable: done.timetable, at: done.at }
      : cache && sameCollege(cache.timetable, code)
        ? { timetable: cache.timetable, at: cache.fetched_at }
        : null;
    if (copy) {
      const t = copy.timetable;
      return {
        kind: "published",
        stored: { data: t.data, result: t.result, at: t.published_at ?? copy.at },
        college: t,
        fetchedAt: copy.at,
        stale: !!done?.error,
        error: done?.error ?? undefined,
      };
    }
    if (!done) return { kind: "loading" };
    return { kind: "none", error: done.error ?? undefined };
  }, [local, remembered, rawCache, code, fetched]);

  return { state, code, refresh };
}
