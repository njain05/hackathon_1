"use client";

import type { RowError } from "@/lib/tables";

export interface Report {
  source: string;
  summary: { sheet: string; added: number; updated: number }[];
  errors: RowError[];
}

export default function ImportReport({ report, onClose }: { report: Report; onClose: () => void }) {
  const added = report.summary.reduce((n, s) => n + s.added, 0);
  const updated = report.summary.reduce((n, s) => n + s.updated, 0);
  const bad = report.errors.length;
  const tone = bad ? "border-err/40" : "border-ok/40";

  return (
    <div role="status" className={`rounded-md border ${tone} bg-paper p-3 text-sm`}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="font-semibold">
            {report.source}: {added} added, {updated} updated
            {bad > 0 && `, ${bad} row${bad > 1 ? "s" : ""} skipped`}
          </p>
          {report.summary.length > 1 && (
            <p className="text-ink-soft">
              {report.summary.map((s) => `${s.sheet} ${s.added + s.updated}`).join(", ")}
            </p>
          )}
          {bad > 0 && (
            <>
              <p className="mt-2 text-ink-soft">Fix these rows in your file and import again, or add them here by hand:</p>
              <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto">
                {report.errors.map((e, i) => (
                  <li key={i} className="text-err">
                    <span className="font-semibold">
                      {e.row > 0 ? `${e.sheet}, row ${e.row}` : e.sheet}:
                    </span>{" "}
                    {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <button type="button" onClick={onClose} className="btn-quiet !px-2 !py-1" aria-label="Close import report">
          Close
        </button>
      </div>
    </div>
  );
}
