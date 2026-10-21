"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

type Status = "checking" | "ok" | "down";

export default function HealthStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { status: string }) =>
        setStatus(data.status === "ok" ? "ok" : "down"),
      )
      .catch(() => setStatus("down"));
  }, []);

  const styles: Record<Status, string> = {
    checking: "bg-paper text-ink-soft",
    ok: "bg-paper text-ok",
    down: "bg-paper text-err",
  };
  const labels: Record<Status, string> = {
    checking: "Checking server…",
    ok: "Server connected",
    down: "Server not reachable",
  };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm font-medium ${styles[status]}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
      {labels[status]}
    </span>
  );
}
