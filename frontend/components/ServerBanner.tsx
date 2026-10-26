"use client";

import { ensureAwake, useServerStatus } from "@/lib/server";

/** Shown on every page while a sleeping server starts up, or if it can't be reached. */
export default function ServerBanner() {
  const status = useServerStatus();
  if (status !== "waking" && status !== "down") return null;
  return (
    <div role="status" aria-live="polite" className="border-b border-line bg-blush px-4 py-2.5 text-sm sm:px-6 print:hidden">
      {status === "waking" ? (
        <p>
          <span className="font-semibold">Waking up the server, this can take up to a minute.</span>{" "}
          <span className="text-ink-soft">It sleeps when nobody has used it for a while. Your work is safe.</span>
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-err">The timetable server isn’t answering.</span>
          <span className="text-ink-soft">Check the internet connection.</span>
          <button type="button" className="btn-quiet !py-1" onClick={() => void ensureAwake(true)}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
