import type { SolveResult } from "@/lib/types";

// Plain-words explanation of each soft-rule penalty from the solver.
const PENALTIES: { key: string; title: string; explain: (n: number) => string }[] = [
  {
    key: "subject_repeats_same_day",
    title: "Same subject twice in a day",
    explain: (n) => (n ? `${n} time${n === 1 ? "" : "s"} a section has the same subject twice on one day.` : "Every subject is spread across the week."),
  },
  {
    key: "student_gaps",
    title: "Free periods between classes",
    explain: (n) => (n ? `${n} empty period${n === 1 ? "" : "s"} where students wait between classes.` : "Students never wait for a class: no gaps in any day."),
  },
  {
    key: "teacher_long_runs",
    title: "Long teaching runs",
    explain: (n) =>
      n ? `${n} time${n === 1 ? "" : "s"} a teacher teaches more than 3 periods in a row without a break.` : "No teacher teaches more than 3 periods in a row.",
  },
  {
    key: "teacher_load_imbalance",
    title: "Uneven teacher days",
    explain: (n) =>
      n
        ? `Teachers' busiest and lightest days differ by ${n} period${n === 1 ? "" : "s"} in total. Some imbalance is normal when a teacher has only a few classes a week.`
        : "Every teacher's classes are spread evenly over the week.",
  },
];

export function VerifiedBadge({ result }: { result: SolveResult }) {
  const clashes = result.check?.clashes ?? [];
  const count = (kind: string) => clashes.filter((c) => c.kind === kind).length;
  const total = clashes.length + (result.check?.violations.length ?? 0);
  const ok = result.check?.ok && total === 0;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-4 py-3 ${ok ? "border-ok/40 bg-mint" : "border-err/40 bg-blush"}`}>
      <span className={`text-lg font-bold ${ok ? "text-ok" : "text-err"}`}>
        {ok ? "Verified: 0 clashes" : `${total} problem${total === 1 ? "" : "s"} found`}
      </span>
      <span className="text-sm">
        Teacher clashes {count("teacher_clash")}, section clashes {count("section_clash")}, room clashes {count("room_clash")}
      </span>
      <span className="w-full text-sm text-ink-soft">
        Checked separately from the solver: no teacher, section or room is ever in two places at once, every lab is in a lab
        room, and every room is big enough.
      </span>
    </div>
  );
}

export function QualityPanel({ result }: { result: SolveResult }) {
  const s = result.stats;
  if (!s) return null;
  return (
    <details className="rounded-md border border-line bg-paper p-4">
      <summary className="cursor-pointer">
        <span className="font-bold">Quality score {s.score}</span>
        <span className="text-ink-soft">
          {" "}
          (lower is better, 0 is perfect{s.optimal ? "; this is the best possible for this data" : ""})
        </span>
      </summary>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {PENALTIES.map((p) => {
          const n = s.penalties[p.key] ?? 0;
          return (
            <li key={p.key} className="flex gap-3">
              <span className={`mt-0.5 min-w-9 rounded-sm px-1.5 text-center font-bold ${n ? "bg-blush" : "bg-mint"}`}>{n}</span>
              <span>
                <span className="block font-semibold">{p.title}</span>
                <span className="text-sm text-ink-soft">{p.explain(n)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
