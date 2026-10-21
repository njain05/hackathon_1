import type { Settings } from "./types";

export interface TimeBlock {
  kind: "period" | "break";
  label: string; // "1", "2"... for periods, the break name for breaks
  start: number; // minutes since midnight
  end: number;
}

export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function periodLength(s: Settings, period: number): number {
  return s.period_lengths?.[period - 1] ?? s.period_minutes;
}

/** The day laid out in order: periods and breaks with real clock times. */
export function dayBlocks(s: Settings): TimeBlock[] {
  const blocks: TimeBlock[] = [];
  let t = parseTime(s.day_start);
  for (let p = 1; p <= s.periods_per_day; p++) {
    const len = periodLength(s, p);
    blocks.push({ kind: "period", label: String(p), start: t, end: t + len });
    t += len;
    const brk = s.breaks.find((b) => b.after_period === p);
    if (brk && p < s.periods_per_day) {
      blocks.push({ kind: "break", label: brk.name || "Break", start: t, end: t + brk.minutes });
      t += brk.minutes;
    }
  }
  return blocks;
}

export function periodTimes(s: Settings): string[] {
  return dayBlocks(s)
    .filter((b) => b.kind === "period")
    .map((b) => `${formatTime(b.start)}–${formatTime(b.end)}`);
}

export function shortDay(day: string): string {
  return day.slice(0, 3);
}
