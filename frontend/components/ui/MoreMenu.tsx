"use client";

import { useEffect, useRef, useState } from "react";

export interface MenuAction {
  label: string;
  onClick: () => void;
  /** Shown in red, e.g. "Start over". */
  danger?: boolean;
}

/** One button that opens a short list of less-used actions, so the page shows its main content first. */
export default function MoreMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="btn-quiet">
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-1 flex min-w-56 flex-col gap-0.5 rounded-md border border-line bg-paper p-1 shadow-lg">
          {actions.map((a) => (
            <li key={a.label}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={`menu-item w-full font-semibold ${a.danger ? "text-err" : ""}`}
              >
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
