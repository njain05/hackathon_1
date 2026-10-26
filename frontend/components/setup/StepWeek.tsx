"use client";

import { useState } from "react";
import { WEEK_DAYS } from "@/lib/templates";
import { departmentsTable } from "@/lib/tables";
import type { Break, CollegeData, Settings } from "@/lib/types";
import NumberInput from "@/components/ui/NumberInput";
import DataTable from "./DataTable";
import DayPreview from "./DayPreview";

interface Props {
  data: CollegeData;
  onChange: (d: CollegeData) => void;
}

// A break's kind decides which control edits it, so renaming it never moves it.
// Older setups have no kind: fall back to the name.
const isLunch = (b: Break) => (b.kind ? b.kind === "lunch" : /lunch/i.test(b.name));
const isTea = (b: Break) => (b.kind ? b.kind === "tea" : !/lunch/i.test(b.name) && /tea/i.test(b.name));

/** A time box you can clear and retype: saves only a complete time, restores the last good one on leaving. */
function TimeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <input
      id={id}
      type="time"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value);
      }}
      onBlur={() => {
        if (!/^\d{2}:\d{2}$/.test(draft)) setDraft(value);
      }}
      className="field w-36"
    />
  );
}

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
            <NumberInput
              aria-label={`${label} length in minutes`}
              min={1}
              max={240}
              unit="minutes"
              value={current.minutes}
              onChange={(n) => onChange({ ...current, minutes: n })}
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
  disabled,
  note,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  suffix?: string;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <NumberInput
          id={id}
          min={min}
          max={max}
          unit={suffix}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-describedby={note ? `${id}-note` : undefined}
          className="field w-24 disabled:opacity-60"
        />
        {suffix && <span className="hint">{suffix}</span>}
      </div>
      {note && (
        <p id={`${id}-note`} className="hint">
          {note}
        </p>
      )}
    </div>
  );
}

export default function StepWeek({ data, onChange }: Props) {
  const s = data.settings;
  const setSettings = (patch: Partial<Settings>) => {
    // Breaks and per-period lengths are kept even if the number of periods drops
    // for a moment (typing 1 on the way to 10). The preview ignores what doesn't
    // fit, and lib/api.ts toApi() trims it before anything goes to the server.
    const next = { ...s, ...patch };
    if (next.period_lengths && next.period_lengths.length < next.periods_per_day) {
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
          <TimeField id="day-start" value={s.day_start} onChange={(v) => setSettings({ day_start: v })} />
        </div>

        <NumberField
          id="period-len"
          label="Each period lasts"
          value={s.period_minutes}
          min={10}
          max={240}
          suffix="minutes"
          onChange={(n) => setSettings({ period_minutes: n })}
          disabled={!!s.period_lengths}
          note={s.period_lengths ? "Periods have their own lengths (Advanced options below)." : undefined}
        />

        <BreakControl
          id="lunch"
          label="Lunch break"
          noneLabel="No lunch break"
          current={lunch}
          taken={s.breaks.filter((b) => b !== lunch).map((b) => b.after_period)}
          periods={periodChoices}
          make={(p) => ({ name: "Lunch", kind: "lunch", after_period: p, minutes: 40, labs_continue: false })}
          onChange={(b) => replaceBreak(lunch, b)}
        />

        <BreakControl
          id="tea"
          label="Tea break (optional)"
          noneLabel="No tea break"
          current={tea}
          taken={s.breaks.filter((b) => b !== tea).map((b) => b.after_period)}
          periods={periodChoices}
          make={(p) => ({ name: "Tea break", kind: "tea", after_period: p, minutes: 10, labs_continue: true })}
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
                  <NumberInput
                    aria-label={`${b.name || "Break"} length in minutes`}
                    min={1}
                    max={240}
                    unit="minutes"
                    value={b.minutes}
                    onChange={(n) => update({ minutes: n })}
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
                  if (free) replaceBreak(undefined, { name: "Break", kind: "other", after_period: free, minutes: 15, labs_continue: false });
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
                    <NumberInput
                      min={10}
                      max={240}
                      unit="minutes"
                      value={m}
                      onChange={(n) => setSettings({ period_lengths: s.period_lengths!.map((x, j) => (j === i ? n : x)) })}
                      className="field w-20"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="field-label">Shorter days</h3>
            <p className="hint">
              If a day has fewer periods, like a half-day Saturday, set it here. Nothing is scheduled after its last period.
            </p>
            {s.days.length === 0 ? (
              <p className="hint">Choose the working days first.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {s.days.map((day) => {
                  const n = s.periods_by_day?.[day] ?? s.periods_per_day;
                  return (
                    <label key={day} className="flex flex-col gap-1 text-sm">
                      {day}
                      <NumberInput
                        min={1}
                        max={s.periods_per_day}
                        unit="periods"
                        value={Math.min(n, s.periods_per_day)}
                        onChange={(v) => {
                          const rest = Object.fromEntries(Object.entries(s.periods_by_day ?? {}).filter(([d]) => d !== day));
                          setSettings({ periods_by_day: v < s.periods_per_day ? { ...rest, [day]: v } : rest });
                        }}
                        className="field w-20"
                      />
                    </label>
                  );
                })}
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
