"use client";

import { useId, useState } from "react";
import type { CollegeData, SolveResult } from "@/lib/types";

/**
 * "Download Excel (all timetables)": one workbook with a sheet for every
 * section, teacher and room. The spreadsheet code loads only when pressed.
 */
export default function ExportButtons({ data, result }: { data: CollegeData; result: SolveResult }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = result.entries.length === 0;
  const hintId = useId();

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { downloadTimetableExcel } = await import("@/lib/exports");
      downloadTimetableExcel(data, result);
    } catch {
      setError("The Excel file couldn't be made. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1 print:hidden">
      <button
        type="button"
        className="btn-quiet"
        onClick={download}
        disabled={busy || empty}
        aria-describedby={hintId}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M8 2v8m0 0L4.8 6.8M8 10l3.2-3.2M2.5 11.5v2h11v-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Preparing…" : "Download Excel (all timetables)"}
      </button>
      <span id={hintId} className="sr-only">
        One sheet for each section, teacher and room, with clock times and breaks.
      </span>
      {error && (
        <p role="alert" className="text-sm text-err">
          {error}
        </p>
      )}
    </div>
  );
}
