"use client";

import { useEffect, useId, useRef, useState } from "react";
import { downloadCsv, downloadWorkbook, importTable, readSpreadsheet } from "@/lib/excel";
import { renameRefs } from "@/lib/store";
import { importGrid, type Column, type RowError, type TableSpec } from "@/lib/tables";
import type { CollegeData } from "@/lib/types";
import ImportReport, { type Report } from "./ImportReport";

interface Props<T> {
  spec: TableSpec<T>;
  data: CollegeData;
  onChange: (d: CollegeData) => void;
  emptyText: string;
}

/** Split text copied from Excel/Sheets (tab-separated) into cells. */
function parsePasted(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.split("\t").map((c) => c.replace(/^"([\s\S]*)"$/, "$1")));
}

function isMultiCell(text: string): boolean {
  return text.includes("\t") || text.trim().includes("\n");
}

export default function DataTable<T>({ spec, data, onChange, emptyText }: Props<T>) {
  const rows = spec.rows(data);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [undo, setUndo] = useState<{ row: T; index: number; label: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // "Download template" closes on Escape and on a click elsewhere, like the other menus.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      if (menuRef.current) menuRef.current.open = false;
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    const click = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && close();
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [menuOpen]);

  const rowLabel = (row: T, i: number) => {
    const code = spec.codeKey ? String((row as Record<string, unknown>)[spec.codeKey] ?? "").trim() : "";
    if (code) return `${spec.noun} ${code}`;
    // No code (e.g. "who teaches what"): name the row by its first two cells.
    const first = spec.columns
      .slice(0, 2)
      .map((c) => String((row as Record<string, unknown>)[c.key] ?? "").trim())
      .filter(Boolean);
    return first.length ? `row ${i + 1} (${first.join(", ")})` : `row ${i + 1}`;
  };
  const deleteRow = (i: number) => {
    const row = rows[i];
    setRows(rows.filter((_, j) => j !== i));
    setUndo({ row, index: i, label: rowLabel(row, i) });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 12000);
  };
  const restoreRow = () => {
    if (!undo) return;
    const next = [...rows];
    next.splice(Math.min(undo.index, next.length), 0, undo.row);
    setRows(next);
    setUndo(null);
  };
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const advanced = spec.columns.filter((c) => c.advanced);
  const cols = spec.columns.filter((c) => showAdvanced || !c.advanced);

  const setRows = (next: T[]) => onChange(spec.withRows(data, next));
  const updateRow = (i: number, row: T) => setRows(rows.map((r, j) => (j === i ? row : r)));

  const addRow = () => {
    setRows([...rows, spec.blank(data)]);
    requestAnimationFrame(() => {
      tableRef.current
        ?.querySelector<HTMLElement>("tbody tr:last-child input, tbody tr:last-child select")
        ?.focus();
    });
  };

  const rename = (from: string, to: string) => {
    if (spec.refKind && from && to && from !== to) onChange(renameRefs(data, spec.refKind, from, to));
  };

  const applyGrid = (grid: string[][], source: string) => {
    const r = importGrid(spec, grid, data);
    onChange(r.data);
    setReport({ source, summary: [{ sheet: spec.sheet, added: r.added, updated: r.updated }], errors: r.errors });
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!isMultiCell(text) || (e.target as HTMLElement).tagName === "TEXTAREA") return;
    e.preventDefault();
    applyGrid(parsePasted(text), "Pasted rows");
  };

  const onFile = async (file: File) => {
    try {
      const sheets = await readSpreadsheet(file);
      const r = importTable(spec, sheets, data);
      onChange(r.data);
      setReport({ source: file.name, summary: r.summary, errors: r.errors });
    } catch {
      const errors: RowError[] = [{
        sheet: spec.sheet,
        row: 0,
        message: "Couldn't read this file. Save it as .xlsx or .csv and try again.",
      }];
      setReport({ source: file.name, summary: [], errors });
    }
  };

  return (
    <section onPaste={onPaste} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addRow} className="btn-primary">
          Add {spec.noun}
        </button>
        <button type="button" onClick={() => setPasteOpen((o) => !o)} className="btn-quiet" aria-expanded={pasteOpen}>
          Paste from Excel
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-quiet">
          Import Excel or CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          aria-label={`Import ${spec.sheet} from a file`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        <details className="relative" ref={menuRef} onToggle={(e) => setMenuOpen(e.currentTarget.open)}>
          <summary className="btn-quiet list-none cursor-pointer">Download template</summary>
          <div className="absolute z-20 mt-1 flex w-64 flex-col rounded-md border border-line bg-paper p-1 shadow-lg">
            <button type="button" className="menu-item" onClick={() => {
                downloadWorkbook(data, spec.sheet);
                if (menuRef.current) menuRef.current.open = false;
              }}>
              Excel workbook (all steps)
            </button>
            <button type="button" className="menu-item" onClick={() => {
                downloadCsv(spec, data);
                if (menuRef.current) menuRef.current.open = false;
              }}>
              CSV for {spec.sheet.toLowerCase()} only
            </button>
          </div>
        </details>
        {advanced.length > 0 && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => setShowAdvanced(e.target.checked)}
              className="accent-navy"
            />
            Advanced options
            <span className="hidden sm:inline">({advanced.map((c) => c.header.toLowerCase()).join(", ")})</span>
          </label>
        )}
      </div>

      {pasteOpen && (
        <div className="rounded-md border border-line bg-blush/50 p-3">
          <label htmlFor={`paste-${spec.id}`} className="text-sm font-semibold">
            Copy rows in Excel, then paste them here
          </label>
          <p className="text-sm text-ink-soft">
            Columns in this order: {spec.columns.filter((c) => c.kind !== "readonly" && (showAdvanced || !c.advanced)).map((c) => c.header).join(", ")}.
            A heading row is fine. Tip: you can also click anywhere on the table and press Ctrl+V.
          </p>
          <textarea
            id={`paste-${spec.id}`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            className="mt-2 w-full rounded-md border border-line bg-paper p-2 font-mono text-sm"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!pasteText.trim()}
              onClick={() => {
                applyGrid(parsePasted(pasteText), "Pasted rows");
                setPasteText("");
                setPasteOpen(false);
              }}
            >
              Add these rows
            </button>
            <button type="button" className="btn-quiet" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {report && <ImportReport report={report} onClose={() => setReport(null)} />}

      {undo && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-30 flex w-[min(92vw,32rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-md border border-line bg-paper px-4 py-3 text-sm shadow-lg"
        >
          <span className="mr-auto">Deleted {undo.label}.</span>
          <button type="button" className="btn-quiet !py-1" onClick={restoreRow}>
            Undo
          </button>
        </div>
      )}

      <div className="relative overflow-x-auto rounded-md border border-line bg-paper">
        <table ref={tableRef} className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-blush text-left">
              <th scope="col" className="w-10 px-2 py-2 text-ink-soft font-normal">#</th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="px-2 py-2 font-semibold whitespace-nowrap" style={{ minWidth: c.width ?? "10rem" }}>
                  {c.header}
                  {c.required && <span className="text-navy" aria-label="required"> *</span>}
                  {c.help && <span className="block text-xs font-normal text-ink-soft whitespace-normal">{c.help}</span>}
                </th>
              ))}
              <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="px-4 py-8 text-center text-ink-soft">
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-line hover:bg-blush/40">
                <td className="px-2 text-ink-soft">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c.key} className="px-1 py-1 align-top">
                    <Cell
                      col={c}
                      row={row}
                      data={data}
                      label={`${c.header}, row ${i + 1}`}
                      onCommit={(r) => updateRow(i, r)}
                      onRename={c.key === spec.codeKey ? rename : undefined}
                      codeTaken={
                        c.key === spec.codeKey
                          ? (code) => rows.some((r, j) => j !== i && String((r as Record<string, unknown>)[c.key] ?? "").trim() === code)
                          : undefined
                      }
                      noun={spec.noun}
                    />
                  </td>
                ))}
                <td className="px-1 text-center">
                  <button
                    type="button"
                    onClick={() => deleteRow(i)}
                    className="rounded px-2 py-1 text-ink-soft hover:bg-blush hover:text-err"
                    aria-label={`Delete ${rowLabel(row, i)}`}
                    title={`Delete ${rowLabel(row, i)}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <p className="text-sm text-ink-soft">
          {rows.length} {spec.noun}
          {rows.length === 1 ? "" : "s"}
        </p>
      )}
    </section>
  );
}

interface CellProps<T> {
  col: Column<T>;
  row: T;
  data: CollegeData;
  label: string;
  onCommit: (row: T) => void;
  onRename?: (from: string, to: string) => void;
  /** For the code column: is this code already used by another row? */
  codeTaken?: (code: string) => boolean;
  noun?: string;
}

function Cell<T>({ col, row, data, label, onCommit, onRename, codeTaken, noun = "row" }: CellProps<T>) {
  const value =
    col.kind === "select"
      ? col.selectValue
        ? col.selectValue(row)
        : String((row as Record<string, unknown>)[col.key] ?? "")
      : col.get(row, data);
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  /** What happened when leaving the cell (a code or number put back), until the next edit. */
  const [note, setNote] = useState<string | null>(null);
  const errorId = useId();

  // Follow outside changes (import, rename, undo) while the admin isn't typing here.
  if (value !== prev) {
    setPrev(value);
    if (!focused) {
      setDraft(value);
      setError(null);
    }
  }

  if (col.kind === "readonly") {
    return <span className="block px-2 py-1.5 text-ink-soft">{col.get(row, data)}</span>;
  }

  if (col.kind === "select") {
    const options = col.options?.(data) ?? [];
    const known = options.some((o) => o.value === value);
    return (
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          const out = col.set(row, e.target.value, data);
          if (typeof out !== "string") onCommit(out);
        }}
        className={`cell ${!known && value ? "cell-invalid" : ""}`}
      >
        {!options.some((o) => o.value === "") && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {!known && value && <option value={value}>{value} (not found)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const commit = (raw: string) => {
    const out = col.set(row, raw, data);
    if (typeof out !== "string") {
      onCommit(out);
      setError(null);
    } else if (col.kind === "text" && !raw.trim()) {
      onCommit({ ...row, [col.key]: "" }); // blank required text: keep it blank, checks will flag it
      setError(out);
    } else {
      setError(out);
    }
  };

  const taken = (raw: string) => Boolean(onRename && raw.trim() && raw.trim() !== original && codeTaken?.(raw.trim()));
  const showError = error && (focused || col.kind === "text");
  const message = showError ? error : note;
  return (
    <div>
      <input
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={message ? errorId : undefined}
        type="text"
        inputMode={col.kind === "number" ? "numeric" : undefined}
        placeholder={col.placeholder ? `e.g. ${col.placeholder}` : undefined}
        value={draft}
        onFocus={() => {
          setFocused(true);
          setOriginal(value);
          setNote(null);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
          if (taken(e.target.value)) setError(`${e.target.value.trim()} is already used by another ${noun}. Codes must be different.`);
        }}
        onBlur={() => {
          setFocused(false);
          if (col.kind === "number" && error) {
            setDraft(value); // put back the last good number, and say so
            setError(null);
            setNote(`“${draft}” isn’t a valid number, so it’s back to ${value || "empty"}.`);
          }
          if (onRename && original) {
            const now = value.trim();
            if (!now || taken(now)) {
              // Never move classes to another row's code, or leave them pointing at nothing.
              commit(original);
              setDraft(original);
              setError(null);
              setNote(!now ? `A code can’t be empty, so it’s back to ${original}.` : `${now} is already used, so this stays ${original}.`);
            } else if (now !== original) onRename(original, now);
          }
        }}
        className={`cell ${error ? "cell-invalid" : ""}`}
      />
      {message && (
        <p id={errorId} role={note && !showError ? "status" : undefined} className="px-1 pt-0.5 text-xs text-err">
          {message}
        </p>
      )}
    </div>
  );
}
