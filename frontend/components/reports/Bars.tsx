// Small chart marks for the reports. One series per chart, so one colour:
// navy for values, err only for a flagged (status) value, which always comes
// with a written label. Thin bars with a 4px rounded end, square at the
// baseline. The numbers are always written next to the bar, so the bar
// itself is hidden from screen readers and the tooltip only repeats them.

/** A horizontal bar on a shared scale, with an optional reference tick (e.g. a department average). */
export function Bar({ value, max, flagged, mark, title }: {
  value: number;
  max: number;
  flagged?: boolean;
  /** Where to draw the reference tick, on the same scale. */
  mark?: number | null;
  /** Hover readout: the same facts as the row's text. */
  title: string;
}) {
  const at = (n: number) => `${max > 0 ? Math.min(100, Math.max(0, (n / max) * 100)) : 0}%`;
  return (
    <div className="relative h-4 min-w-0 flex-1" title={title} aria-hidden>
      <div className={`h-full rounded-r-[4px] ${flagged ? "bg-err" : "bg-navy"}`} style={{ width: at(value) }} />
      {mark != null && max > 0 && (
        // A 2px ring in the surface colour keeps the tick readable where it crosses the bar.
        <div className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-ink ring-2 ring-paper" style={{ left: at(mark) }} />
      )}
    </div>
  );
}

/** A share of a fixed limit (e.g. slots used out of the week): a filled part on a lighter track of the same blue. */
export function Meter({ share, title }: { share: number; title: string }) {
  const pct = `${Math.min(100, Math.max(0, share * 100))}%`;
  return (
    <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-sky/25" title={title} aria-hidden>
      <div className="h-full rounded-r-[4px] bg-navy" style={{ width: pct }} />
    </div>
  );
}

/** Status label for a flagged row: icon + words, never colour alone. */
export function FlagBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 rounded-sm bg-blush px-2 py-0.5 text-sm font-semibold text-err">
      <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <rect x="7.1" y="3.5" width="1.8" height="5.6" rx="0.9" fill="white" />
        <circle cx="8" cy="11.6" r="1.05" fill="white" />
      </svg>
      <span>{children}</span>
    </span>
  );
}

/** A neutral note on a row (e.g. a room that could be freed). */
export function NoteBadge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-sm bg-mint px-2 py-0.5 text-sm font-semibold text-ink">{children}</span>;
}

/** Key for the workload chart: what the bar, the tick and a red bar mean. */
export function WorkloadKey() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft" aria-label="How to read the bars">
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-r-[3px] bg-navy" aria-hidden />
        Periods a week
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-0.5 bg-ink" aria-hidden />
        Their department&apos;s average
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-r-[3px] bg-err" aria-hidden />
        Flagged (reason written beside it)
      </li>
    </ul>
  );
}
