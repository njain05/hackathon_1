"use client";

import { useId, useState } from "react";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max">;

interface Props extends InputProps {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  /** Word after the number in the error, e.g. "minutes". */
  unit?: string;
}

/**
 * A whole-number box that behaves like people expect: you can delete, retype
 * and paste freely. A valid number is saved as you type. An empty or
 * out-of-range value shows a hint, and goes back to the last good value when
 * you leave the box. Arrow up/down still step by one. No accidental changes
 * from the mouse wheel, and no letters like "e".
 */
export default function NumberInput({ value, min, max, onChange, unit, className, onFocus, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [prev, setPrev] = useState(value);
  const [focused, setFocused] = useState(false);
  const hintId = useId();

  // Follow outside changes (templates, imports) while the person isn't typing here.
  if (value !== prev) {
    setPrev(value);
    if (!focused) setDraft(String(value));
  }

  const parsed = Number(draft);
  const valid = draft !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;

  const save = (n: number) => {
    if (n !== value) onChange(n);
  };

  const step = (by: number) => {
    const next = Math.min(max, Math.max(min, (valid ? parsed : value) + by));
    setDraft(String(next));
    save(next);
  };

  return (
    <span className="inline-flex flex-col gap-0.5">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        aria-invalid={!valid}
        aria-describedby={!valid ? hintId : undefined}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select(); // typing replaces the old number
          onFocus?.(e);
        }}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, "");
          setDraft(digits);
          const n = Number(digits);
          if (digits !== "" && n >= min && n <= max) save(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            step(e.key === "ArrowUp" ? 1 : -1);
          }
        }}
        onBlur={(e) => {
          setFocused(false);
          if (!valid) setDraft(String(value));
          onBlur?.(e);
        }}
        className={`${className ?? "field"} ${valid ? "" : "!border-err"}`}
      />
      {!valid && (
        <span id={hintId} role="alert" className="text-xs text-err">
          Enter a number from {min} to {max}
          {unit ? ` ${unit}` : ""}.
        </span>
      )}
    </span>
  );
}
