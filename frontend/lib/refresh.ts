"use client";

import { useEffect, useRef } from "react";

const SHOWN_AGAIN_GAP_MS = 30_000;

/**
 * Calls `again` when the page is shown again (back from another app or tab), at most
 * every 30 s: some browsers report "shown" many times a minute, and each call is a request
 * to a server that may be on a free plan.
 */
export function useRefreshWhenShown(again: () => void) {
  const latest = useRef(again);
  useEffect(() => {
    latest.current = again;
  });
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < SHOWN_AGAIN_GAP_MS) return;
      last = Date.now();
      latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
