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
const isTea = (b: Break) => !isLunch(b) && /tea/i.test(b.name);

const FIVE_DAYS = WEEK_DAYS.slice(0, 5);
const SIX_DAYS = WEEK_DAYS.slice(0, 6);
const sameDays = (a: string[], b: string[]) => a.length === b.length && a.every((d, i) => d === b[i]);

interface BreakControlProps {
  id: string;
  label: string;
  noneLabel: string;
  current: Break | undefined;
  taken: number[];
  periods: number[];
  make: (afterPeriod: number) => Break;
  onChange: (b: Break | undefined) => void;
  showLabsToggle?: boolean;
}

/** "No lunch break" / "After period N for M minutes" control used for lunch and tea. */
function BreakControl({ id, label, noneLabel, current, taken, periods, make, onChange, showLabsToggle }: BreakControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        <select
          aria-label={`${label}: comes after period`}
          value={current ? String(current.after_period) : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v ? (current ? { ...current, after_period: Number(v) } : make(Number(v))) : undefined);
          }}
          className="field"
        >
          <option value="">{noneLabel}</option>
          {periods.map((p) => (
            <option key={p} value={p} disabled={taken.includes(p)}>
              After period {p}
            </option>
          ))}
        </select>
        {current && (
          <>
            <span className="hint">for</span>
            <input
              aria-label={`${label} length in minutes`}
              type="number"
              min={1}
              max={240}
              value={current.minutes}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 1 && n <= 240) onChange({ ...current, minutes: n });
              }}
              className="field w-20"
            />
            <span className="hint">minutes</span>
          </>
        )}
      </div>
      {current && showLabsToggle && (
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-navy"
            checked={current.labs_continue}
            onChange={(e) => onChange({ ...current, labs_continue: e.target.checked })}
          />
          A lab session can run straight across this break
        </label>
      )}
    </div>
  );
}

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
  const tea = s.breaks.find(isTea);
  const otherBreaks = s.breaks.filter((b) => b !== lunch && b !== tea);
  const setBreaks = (all: Break[]) => {
    // Safety net: one break per position (the dropdowns already disable taken positions).
    const seen = new Set<number>();
    const unique = all.filter((b) => (seen.has(b.after_period) ? false : (seen.add(b.after_period), true)));
    setSettings({ breaks: unique.sort((x, y) => x.after_period - y.after_period) });
  };
  /** Swap one break for another (or add / remove one). */
  const replaceBreak = (old: Break | undefined, next: Break | undefined) =>
    setBreaks(
      old
        ? s.breaks.flatMap((b) => (b === old ? (next ? [next] : []) : [b]))
        : next
          ? [...s.breaks, next]
          : s.breaks,
    );
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="hint">Quick choice:</span>
            <button
              type="button"
              className={`btn-quiet ${sameDays(s.days, FIVE_DAYS) ? "!border-navy !bg-sky/40" : ""}`}
              aria-pressed={sameDays(s.days, FIVE_DAYS)}
              onClick={() => setSettings({ days: FIVE_DAYS })}
            >
              5-day week (Mon–Fri)
            </button>
            <button
              type="button"
              className={`btn-quiet ${sameDays(s.days, SIX_DAYS) ? "!border-navy !bg-sky/40" : ""}`}
              aria-pressed={sameDays(s.days, SIX_DAYS)}
              onClick={() => setSettings({ days: SIX_DAYS })}
            >
              6-day week (Mon–Sat)
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => {
              const on = s.days.includes(day);
              return (
                <label
                  key={day}
                  className={`cursor-pointer rounded-md border px-4 py-2 text-sm font-semibold select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${
                    on ? "border-navy bg-sky/40 text-ink" : "border-line bg-paper text-ink-soft hover:bg-blush"
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
          {s.days.length === 0 && (
            <p className="text-sm font-semibold text-err">Choose the days your college has classes, or use a quick choice.</p>
          )}
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

        <BreakControl
          id="lunch"
          label="Lunch break"
          noneLabel="No lunch break"
          current={lunch}
          taken={s.breaks.filter((b) => b !== lunch).map((b) => b.after_period)}
          periods={periodChoices}
          make={(p) => ({ name: "Lunch", after_period: p, minutes: 40, labs_continue: false })}
          onChange={(b) => replaceBreak(lunch, b)}
        />

        <BreakControl
          id="tea"
          label="Tea break (optional)"
          noneLabel="No tea break"
          current={tea}
          taken={s.breaks.filter((b) => b !== tea).map((b) => b.after_period)}
          periods={periodChoices}
          make={(p) => ({ name: "Tea break", after_period: p, minutes: 10, labs_continue: true })}
          onChange={(b) => replaceBreak(tea, b)}
          showLabsToggle
        />
      </div>

      <DayPreview settings={s} />

      <details className="rounded-md border border-line bg-paper p-4">
        <summary className="cursor-pointer font-semibold">Advanced options: more breaks, periods of different lengths</summary>
        <div className="mt-4 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="field-label">Other breaks</h3>
            <p className="hint">
              Any extra breaks, such as a prayer or assembly break. Tick “Labs continue” if a lab session may run straight across it.
            </p>
            {otherBreaks.map((b, i) => {
              const update = (patch: Partial<Break>) => replaceBreak(b, { ...b, ...patch });
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
                  <button type="button" className="btn-quiet !px-2 !py-1" onClick={() => replaceBreak(b, undefined)}>
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
                  if (free) replaceBreak(undefined, { name: "Break", after_period: free, minutes: 15, labs_continue: false });
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
