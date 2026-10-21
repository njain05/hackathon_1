import { dayBlocks, formatTime } from "@/lib/periods";
import type { Settings } from "@/lib/types";

/** The admin's real day, drawn to scale: periods and breaks with clock times. */
export default function DayPreview({ settings }: { settings: Settings }) {
  const blocks = dayBlocks(settings);
  if (!blocks.length) return null;
  const start = blocks[0].start;
  const end = blocks[blocks.length - 1].end;
  const teachingMinutes = blocks.filter((b) => b.kind === "period").reduce((n, b) => n + b.end - b.start, 0);
  const teachingHours = Math.round((teachingMinutes / 60) * 10) / 10;

  return (
    <figure className="rounded-md border border-line bg-paper p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">Your day</span>
        <span className="text-sm text-ink-soft">
          {formatTime(start)} to {formatTime(end)}, {settings.periods_per_day} periods
        </span>
      </figcaption>
      <ol className="flex h-24 w-full overflow-hidden rounded border border-line" aria-label="Periods and breaks in a day">
        {blocks.map((b, i) => (
          <li
            key={i}
            style={{ flexGrow: b.end - b.start, flexBasis: 0, minWidth: b.kind === "break" ? "2.75rem" : undefined }}
            className={`flex min-w-0 flex-col justify-between border-l border-line px-1.5 py-1 first:border-l-0 ${
              b.kind === "break" ? "bg-mint" : "bg-paper"
            }`}
            title={`${b.kind === "period" ? `Period ${b.label}` : b.label}: ${formatTime(b.start)}–${formatTime(b.end)}`}
          >
            <span className={`truncate ${b.kind === "period" ? "text-lg font-bold" : "text-xs font-semibold"}`}>
              {b.kind === "break" ? b.label.split(" ")[0] : b.label}
            </span>
            <span className="truncate text-[11px] text-ink-soft">{formatTime(b.start)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-ink-soft">
        {teachingHours} hours of teaching a day, {settings.days.length} days a week.
      </p>
    </figure>
  );
}
