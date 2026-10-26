// One department's view of a setup table: only its rows, new rows belong to
// it, and department fields offer only that department. Saving merges the
// rows back with everyone else's (the server does the same check).

import type { Column, ElectiveRow, TableSpec } from "./tables";
import type { CollegeData } from "./types";

type Owner<T> = (row: T, d: CollegeData) => string | null | undefined;

export function scopeSpec<T>(
  spec: TableSpec<T>,
  dept: string,
  owner: Owner<T>,
  /** Make a new blank row belong to the department (e.g. pick one of its sections). */
  ownBlank?: (row: T, d: CollegeData) => T,
): TableSpec<T> {
  const mine = (d: CollegeData) => (row: T) => owner(row, d) === dept;
  return {
    ...spec,
    columns: spec.columns.map((c): Column<T> =>
      c.key === "department_id" && c.kind === "select"
        ? { ...c, options: (d) => d.departments.filter((x) => x.id === dept).map((x) => ({ value: x.id, label: `${x.id} – ${x.name}` })) }
        : c,
    ),
    blank: (d) => {
      const raw = spec.blank(d) as Record<string, unknown>;
      const row = ("department_id" in raw ? { ...raw, department_id: dept } : raw) as T;
      return ownBlank ? ownBlank(row, d) : row;
    },
    rows: (d) => spec.rows(d).filter(mine(d)),
    withRows: (d, rows) => spec.withRows(d, [...spec.rows(d).filter((r) => !mine(d)(r)), ...rows]),
  };
}

export const byDepartment = <T extends { department_id: string | null }>(row: T) => row.department_id;

export const assignmentOwner = (row: { section_id: string }, d: CollegeData) =>
  d.sections.find((s) => s.id === row.section_id)?.department_id;

/** An open elective belongs to a department when all its choices are that department's subjects. */
export const electiveOwner = (row: ElectiveRow, d: CollegeData) => {
  const group = (d.elective_groups ?? []).find((g) => g.id === row.group_id);
  const subjects = group ? group.options.map((o) => o.subject_id) : [row.subject_id];
  const depts = new Set(subjects.map((id) => d.subjects.find((s) => s.id === id)?.department_id));
  return depts.size === 1 ? [...depts][0] : null;
};
