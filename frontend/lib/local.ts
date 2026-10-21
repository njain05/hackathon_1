"use client";

import { useSyncExternalStore } from "react";

// Small wrapper over localStorage for per-browser conveniences.
// Every access is guarded: storage can be blocked, full or cleared.

const EVENT = "local-storage-change";

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event(EVENT));
    return true;
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** The stored string: `undefined` before the browser has loaded, `null` if unset. */
export function useLocal(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readLocal(key),
    () => undefined,
  );
}
