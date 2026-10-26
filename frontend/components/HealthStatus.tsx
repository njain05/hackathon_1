"use client";

import { useEffect } from "react";
import { ensureAwake, useServerStatus, type ServerStatus } from "@/lib/server";

const STYLE: Record<ServerStatus, string> = {
  unknown: "text-ink-soft",
  waking: "text-ink",
  awake: "text-ok",
  down: "text-err",
};

const LABEL: Record<ServerStatus, string> = {
  unknown: "Checking server…",
  waking: "Waking up the server…",
  awake: "Server connected",
  down: "Server not reachable",
};

export default function HealthStatus() {
  const status = useServerStatus();

  // Start waking the server as soon as someone lands on the home page.
  useEffect(() => {
    void ensureAwake();
  }, []);

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-sm font-medium ${STYLE[status]}`}>
      <span className={`h-2 w-2 rounded-full bg-current ${status === "waking" ? "animate-pulse" : ""}`} />
      {LABEL[status]}
    </span>
  );
}
