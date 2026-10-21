"use client";

import { WEEK_DAYS } from "@/lib/templates";
import { departmentsTable } from "@/lib/tables";
import type { Break, CollegeData, Settings } from "@/lib/types";
import DataTable from "./DataTable";
import DayPreview from "./DayPreview";

interface Props {
  data: CollegeData;
  onChange: (d: CollegeData) => void;
}

const isLunch = (b: Break) => /lunch/i.test(b.name);

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          className="field w-24"
        />
        {suffix && <span className="hint">{suffix}</span>}
      </div>
    </div>
  );
}

export default function StepWeek({ data, onChange }: Props) {
  const s = data.settings;
  const setSettings = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    // Keep breaks and per-period lengths valid when the number of periods changes.
    next.breaks = next.breaks.filter((b) => b.after_period < next.periods_per_day);
    if (next.period_lengths && next.period_lengths.length !== next.periods_per_day) {
      next.period_lengths = Array.from({ length: next.periods_per_day }, (_, i) => next.period_lengths?.[i] ?? next.period_minutes);
    }
    onChange({ ...data, settings: next });
  };

  const lunch = s.breaks.find(isLunch);
  const otherBreaks = s.breaks.filter((b) => !isLunch(b));
  const setBreaks = (lunchBreak: Break | undefined, others: Break[]) => {
    const all = [...(lunchBreak ? [lunchBreak] : []), ...others];
    // Safety net: one break per position (the dropdowns already disable taken positions).
    const seen = new Set<number>();
    const unique = all.filter((b) => (seen.has(b.after_period) ? false : (seen.add(b.after_period), true)));
    setSettings({ breaks: unique.sort((a, b) => a.after_period - b.after_period) });
  };
  const periodChoices = Array.from({ length: Math.max(0, s.periods_per_day - 1) }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="college-name" className="field-label">
            College name
          </label>
          <input
            id="college-name"
            value={data.name}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
            placeholder="e.g. Government College of Engineering, Patiala"
            className="field max-w-xl"
          />
        </div>

        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="field-label mb-1">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => {
              const on = s.days.includes(day);
              return (
                <label
                  key={day}
                  className={`cursor-pointer rounded-md border px-3 py-2 text-sm font-semibold select-none ${
                    on ? "border-navy bg-sky" : "border-line bg-paper text-ink-soft hover:bg-blush"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setSettings({
                        days: on ? s.days.filter((d) => d !== day) : WEEK_DAYS.filter((d) => d === day || s.days.includes(d)),
                      })
                    }
                  />
                  {day}
                </label>
              );
            })}
          </div>
        </fieldset>

        <NumberField id="periods" label="Periods a day" value={s.periods_per_day} min={1} max={16} onChange={(n) => setSettings({ periods_per_day: n })} />

        <div className="flex flex-col gap-1">
          <label htmlFor="day-start" className="field-label">
            First period starts at
          </label>
          <input
            id="day-start"
            type="time"
            value={s.day_start}
            onChange={(e) => e.target.value && setSettings({ day_start: e.target.value })}
            className="field w-36"
          />
        </div>

        <NumberField
          id="period-len"
          label="Each period lasts"
          value={s.period_minutes}
          min={10}
          max={240}
          suffix="minutes"
          onChange={(n) => setSettings({ period_minutes: n })}
        />

        <div className="flex flex-col gap-1">
          <span className="field-label" id="lunch-label">
            Lunch break
          </span>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="lunch-label">
            <select
              aria-label="Lunch comes after period"
              value={lunch ? String(lunch.after_period) : ""}
              onChange={(e) => {
                const v = e.target.value;
                setBreaks(
                  v ? { name: "Lunch", minutes: lunch?.minutes ?? 40, labs_continue: false, after_period: Number(v) } : undefined,
                  otherBreaks,
                );
              }}
              className="field"
            >
              <option value="">No lunch break</option>
              {periodChoices.map((p) => (
                <option key={p} value={p} disabled={otherBreaks.some((b) => b.after_period === p)}>
                  After period {p}
                </option>
              ))}
            </select>
            {lunch && (
              <>
                <span className="hint">for</span>
                <input
                  aria-label="Lunch length in minutes"
                  type="number"
                  min={5}
                  max={180}
                  value={lunch.minutes}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (n >= 1 && n <= 240) setBreaks({ ...lunch, minutes: n }, otherBreaks);
                  }}
                  className="field w-20"
                />
                <span className="hint">minutes</span>
              </>
            )}
          </div>
        </div>
      </div>

      <DayPreview settings={s} />

      <details className="rounded-md border border-line bg-paper p-4">
        <summary className="cursor-pointer font-semibold">Advanced options: more breaks, periods of different lengths</summary>
        <div className="mt-4 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="field-label">Other breaks</h3>
            <p className="hint">
              For example a 10-minute tea break. Tick “Labs continue” if a lab session may run straight across it.
            </p>
            {otherBreaks.map((b, i) => {
              const update = (patch: Partial<Break>) =>
                setBreaks(lunch, otherBreaks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input aria-label="Break name" value={b.name} onChange={(e) => update({ name: e.target.value })} className="field w-40" />
                  <select aria-label="Break comes after period" value={b.after_period} onChange={(e) => update({ after_period: Number(e.target.value) })} className="field">
                    {periodChoices.map((p) => (
                      <option key={p} value={p} disabled={p !== b.after_period && s.breaks.some((x) => x.after_period === p)}>
                        After period {p}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Break length in minutes"
                    type="number"
                    min={1}
                    max={240}
                    value={b.minutes}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (n >= 1 && n <= 240) update({ minutes: n });
                    }}
                    className="field w-20"
                  />
                  <span className="hint">min</span>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="accent-navy" checked={b.labs_continue} onChange={(e) => update({ labs_continue: e.target.checked })} />
                    Labs continue
                  </label>
                  <button type="button" className="btn-quiet !px-2 !py-1" onClick={() => setBreaks(lunch, otherBreaks.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              );
            })}
            <div>
              <button
                type="button"
                className="btn-quiet"
                disabled={!periodChoices.some((p) => !s.breaks.some((b) => b.after_period === p))}
                onClick={() => {
                  const free = periodChoices.find((p) => !s.breaks.some((b) => b.after_period === p));
                  if (free) setBreaks(lunch, [...otherBreaks, { name: "Tea break", after_period: free, minutes: 10, labs_continue: true }]);
                }}
              >
                Add a break
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                className="accent-navy"
                checked={!!s.period_lengths}
                onChange={(e) =>
                  setSettings({ period_lengths: e.target.checked ? Array(s.periods_per_day).fill(s.period_minutes) : null })
                }
              />
              Periods have different lengths
            </label>
            {s.period_lengths && (
              <div className="flex flex-wrap gap-3">
                {s.period_lengths.map((m, i) => (
                  <label key={i} className="flex flex-col gap-1 text-sm">
                    Period {i + 1}
                    <input
                      type="number"
                      min={10}
                      max={240}
                      value={m}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (n >= 10 && n <= 240)
                          setSettings({ period_lengths: s.period_lengths!.map((x, j) => (j === i ? n : x)) });
                      }}
                      className="field w-20"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Departments</h2>
        <p className="hint">Add each department with a short code. You’ll use these codes in the next steps.</p>
        <DataTable spec={departmentsTable} data={data} onChange={onChange} emptyText="No departments yet. Add one, or paste them from Excel." />
      </div>
    </div>
  );
}
