"use client";

// Keeps track of whether the backend is awake.
// A free Render server sleeps after ~15 minutes without traffic and takes up
// to a minute to start again. Instead of failing, every API call first makes
// sure the server is up, and the UI shows "Waking up the server…" meanwhile.

import { useSyncExternalStore } from "react";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type ServerStatus = "unknown" | "awake" | "waking" | "down";

const WAKE_LIMIT_MS = 90_000; // give up after this long
const POLL_EVERY_MS = 3_000;
const QUICK_CHECK_MS = 4_000; // an awake server answers /health well within this
const TRUST_AWAKE_MS = 5 * 60_000; // skip the check if the server answered recently

let status: ServerStatus = "unknown";
let lastAwake = 0;
let waking: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function setStatus(s: ServerStatus) {
  status = s;
  listeners.forEach((l) => l());
}

export function markAwake() {
  lastAwake = Date.now();
  if (status !== "awake") setStatus("awake");
}

async function healthOnce(timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves true once the server answers /health, false if it doesn't within
 * WAKE_LIMIT_MS. Concurrent callers share one wake-up attempt.
 */
export function ensureAwake(force = false): Promise<boolean> {
  if (!force && status === "awake" && Date.now() - lastAwake < TRUST_AWAKE_MS) return Promise.resolve(true);
  if (waking) return waking;
  waking = (async () => {
    if (await healthOnce(QUICK_CHECK_MS)) {
      markAwake();
      return true;
    }
    setStatus("waking");
    const deadline = Date.now() + WAKE_LIMIT_MS;
    while (Date.now() < deadline) {
      if (await healthOnce(15_000)) {
        markAwake();
        return true;
      }
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    }
    setStatus("down");
    return false;
  })().finally(() => {
    waking = null;
  });
  return waking;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useServerStatus(): ServerStatus {
  return useSyncExternalStore(subscribe, () => status, () => "unknown");
}
