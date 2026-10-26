"use client";

import { useId, useState } from "react";
import NumberInput from "@/components/ui/NumberInput";
import type { ViewKind } from "@/lib/grid";
import type { CollegeData, Entry } from "@/lib/types";

interface Props {
  data: CollegeData;
  /** The person's own classes, e.g. entriesFor(result.entries, "section", id). */
  entries: Entry[];
  view: ViewKind;
  /** Whose timetable, e.g. "CSE-3A – CSE 3rd Sem A". Used in the file and calendar name. */
  label: string;
}

/** "Add to my calendar": downloads an .ics file with each class repeating weekly. */
export default function CalendarExport({ data, entries, view, label }: Props) {
  const [weeks, setWeeks] = useState(16);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const weeksId = useId();

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { downloadIcs, fileSlug, icsForEntries, unplaceableDays } = await import("@/lib/exports");
      const text = icsForEntries(data, entries, view, label, { from: new Date(), weeks });
      const events = text.split("BEGIN:VEVENT").length - 1;
      const skipped = unplaceableDays(data);
      if (!events) {
        setMessage({ ok: false, text: "There were no classes to add. Calendars need days named Monday to Sunday." });
        return;
      }
      const name = `${fileSlug(label)}-timetable.ics`;
      downloadIcs(name, text);
      setMessage({
        ok: true,
        text:
          `Downloaded ${name}: ${events} class${events === 1 ? "" : "es"} a week, repeating for ${weeks} week${weeks === 1 ? "" : "s"}. Open it to add them to your calendar.` +
          (skipped.length ? ` Left out ${skipped.join(", ")}: calendars only understand Monday to Sunday.` : ""),
      });
    } catch {
      setMessage({ ok: false, text: "The calendar file couldn't be made. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${weeksId}-title`} className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4 print:hidden">
      <div className="flex flex-col gap-1">
        <h2 id={`${weeksId}-title`} className="text-xl font-bold">
          Add to my calendar
        </h2>
        <p className="text-ink-soft">
          Downloads a calendar file that phones and Google or Outlook calendars can import, with each class repeating every
          week from this week on.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={weeksId} className="field-label">
            Repeat for
          </label>
          <span className="flex items-start gap-2">
            <NumberInput id={weeksId} value={weeks} min={1} max={52} unit="weeks" onChange={setWeeks} className="field w-20" />
            <span className="py-2">weeks</span>
          </span>
        </div>
        <button type="button" className="btn-primary mb-0.5" onClick={download} disabled={busy || entries.length === 0}>
          {busy ? "Preparing…" : "Download calendar file (.ics)"}
        </button>
      </div>
      {entries.length === 0 && <p className="hint">There are no classes to add yet.</p>}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-ok" : "text-err"}>
          {message.text}
        </p>
      )}
      <p className="hint">
        This is a one-time copy: if the timetable changes later, your calendar won&apos;t update. Delete the old events and
        download a new file.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-navy">How to import it</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-soft">
          <li>iPhone: open the downloaded file and tap Add All.</li>
          <li>Android: open the file with your calendar app.</li>
          <li>Google Calendar on a computer: Settings, then Import &amp; export, then choose the file.</li>
          <li>Outlook: drag the file onto your calendar, or use File, then Open &amp; Export, then Import.</li>
        </ul>
      </details>
    </section>
  );
}
