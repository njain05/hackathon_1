// Excel / CSV templates and import, all in the browser (no upload to a server).

import * as XLSX from "xlsx";
import {
  ALL_TABLES,
  exportCell,
  importGrid,
  type RowError,
  type TableSpec,
} from "./tables";
import type { CollegeData } from "./types";

const norm = (s: string) => s.trim().toLowerCase();

const SHEET_ALIASES: Record<string, string[]> = {
  assignments: ["who teaches what", "assignments", "classes", "teaching load", "load"],
};

function headerRow<T>(spec: TableSpec<T>): string[] {
  return spec.columns
    .filter((c) => c.kind !== "readonly")
    .map((c) => (c.required ? `${c.header}*` : c.header));
}

function dataRows<T>(spec: TableSpec<T>, d: CollegeData): string[][] {
  const cols = spec.columns.filter((c) => c.kind !== "readonly");
  return spec.rows(d).map((row) => cols.map((c) => exportCell(c, row, d)));
}

function howToSheet(d: CollegeData): XLSX.WorkSheet {
  const rows: string[][] = [
    ["How to fill this workbook"],
    [""],
    ["Fill the sheets from left to right. Each sheet is one step of the setup."],
    ["Columns marked * are required. Keep the heading row as it is."],
    ["Refer to departments, rooms, teachers, sections and subjects by their code (e.g. CSE, C-101, HK, CSE-3A, CS201)."],
    ["Then open the setup page, choose Import workbook, and pick this file. Rows with problems are listed so you can fix them."],
    [""],
    ["Sheet", "Column", "Required", "What to write"],
  ];
  for (const spec of ALL_TABLES) {
    for (const c of spec.columns) {
      if (c.kind === "readonly") continue;
      let what = c.help ?? c.placeholder ?? "";
      if (c.kind === "select" && c.options) {
        const opts = c.options(d).map((o) => (c.exportAs === "label" ? o.label : o.value || o.label));
        if (opts.length) what = `One of: ${opts.slice(0, 12).join(", ")}${opts.length > 12 ? ", …" : ""}`;
      }
      if (c.kind === "number" && !what) what = "A whole number";
      rows.push([spec.sheet, c.header, c.required ? "Yes" : "No", what]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 80 }];
  return ws;
}

/** One workbook with a sheet per step, holding whatever is already entered. */
export function downloadWorkbook(d: CollegeData, activeSheet?: string): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, howToSheet(d), "How to use");
  for (const spec of ALL_TABLES) {
    const ws = XLSX.utils.aoa_to_sheet([headerRow(spec), ...dataRows(spec, d)]);
    ws["!cols"] = headerRow(spec).map((h) => ({ wch: Math.max(14, h.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, spec.sheet);
  }
  const active = activeSheet ? wb.SheetNames.indexOf(activeSheet) : 0;
  // activeTab is supported by SheetJS but missing from its type definitions.
  wb.Workbook = { Views: [{ activeTab: Math.max(0, active) } as XLSX.WBView] };
  XLSX.writeFile(wb, "timetable-setup.xlsx");
}

export function downloadCsv<T>(spec: TableSpec<T>, d: CollegeData): void {
  const ws = XLSX.utils.aoa_to_sheet([headerRow(spec), ...dataRows(spec, d)]);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${spec.sheet.toLowerCase().replace(/\s+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export interface Sheet {
  name: string;
  rows: string[][];
}

export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }),
  }));
}

function sheetFor<T>(spec: TableSpec<T>, sheets: Sheet[]): Sheet | undefined {
  const names = [spec.sheet, spec.id, ...(SHEET_ALIASES[spec.id] ?? [])].map(norm);
  return sheets.find((s) => names.includes(norm(s.name)));
}

export interface FileImport {
  data: CollegeData;
  summary: { sheet: string; added: number; updated: number }[];
  errors: RowError[];
}

/** Import one step's table: its own sheet if present, otherwise the first sheet (CSV). */
export function importTable<T>(spec: TableSpec<T>, sheets: Sheet[], d: CollegeData): FileImport {
  const sheet = sheetFor(spec, sheets) ?? (sheets.length === 1 ? sheets[0] : undefined);
  if (!sheet) {
    return {
      data: d,
      summary: [],
      errors: [{
        sheet: spec.sheet,
        row: 0,
        message: `This file has no "${spec.sheet}" sheet. Use the template, or a CSV with just this table.`,
      }],
    };
  }
  const r = importGrid(spec, sheet.rows, d);
  return { data: r.data, summary: [{ sheet: spec.sheet, added: r.added, updated: r.updated }], errors: r.errors };
}

/** Import every step's sheet found in the workbook, in dependency order. */
/**
 * `merge`: add new rows, update matching ones, keep the rest.
 * `replace`: each table that has a sheet in the file becomes exactly what the file says
 * (rows not in the file are removed), so a corrected re-upload really changes the setup.
 */
/** The setup tables this workbook has sheets for, e.g. ["Rooms", "Teachers"]. */
export function sheetsIn(sheets: Sheet[]): string[] {
  return ALL_TABLES.filter((spec) => sheetFor(spec, sheets)).map((spec) => spec.sheet);
}

export function importWorkbook(sheets: Sheet[], d: CollegeData, mode: "merge" | "replace" = "merge"): FileImport {
  let data = d;
  const summary: FileImport["summary"] = [];
  const errors: RowError[] = [];
  for (const spec of ALL_TABLES) {
    const sheet = sheetFor(spec, sheets);
    if (!sheet) continue;
    if (mode === "replace") data = spec.withRows(data, []);
    const r = importGrid(spec, sheet.rows, data);
    data = r.data;
    summary.push({ sheet: spec.sheet, added: r.added, updated: r.updated });
    errors.push(...r.errors);
  }
  if (!summary.length) {
    errors.push({
      sheet: "Workbook",
      row: 0,
      message: `No setup sheets found. Expected sheets named ${ALL_TABLES.map((t) => `"${t.sheet}"`).join(", ")}. Download the template to see the layout.`,
    });
  }
  return { data, summary, errors };
}
