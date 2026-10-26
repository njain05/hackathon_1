"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppNav from "@/components/AppNav";
import DataTable from "@/components/setup/DataTable";
import DayPreview from "@/components/setup/DayPreview";
import { ApiError, checkCollege } from "@/lib/api";
import {
  departmentStatus,
  getDepartmentSetup,
  saveDepartmentSetup,
  setDepartmentReady,
  type DepartmentState,
  type Staff,
} from "@/lib/departments";
import { useMemberAccess, useOpenMemberLink } from "@/lib/members";
import { assignmentOwner, byDepartment, scopeSpec } from "@/lib/scope";
import { assignmentsTable, roomsTable, sectionsTable, subjectsTable, teachersTable } from "@/lib/tables";
import type { CollegeData, Problem } from "@/lib/types";
import InchargeLink from "./InchargeLink";
import RoomSharing from "./RoomSharing";

type Tab = "rooms" | "teachers" | "sections" | "subjects" | "ready";
const TABS: { id: Tab; label: string }[] = [
  { id: "rooms", label: "Rooms" },
  { id: "teachers", label: "Teachers" },
  { id: "sections", label: "Sections" },
  { id: "subjects", label: "Subjects & classes" },
  { id: "ready", label: "Check & mark ready" },
];

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string; ignored: string[] }
  | { kind: "error"; message: string };

export default function DepartmentPage() {
  const opening = useOpenMemberLink("incharge");
  const incharge = useMemberAccess("incharge");
  const hod = useMemberAccess("hod");
  const member = incharge ?? hod;
  const staff = useMemo<Staff | null>(() => (member ? { member } : null), [member]);
  const dept = member?.department_id ?? "";

  const [data, setData] = useState<CollegeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [tab, setTab] = useState<Tab>("rooms");
  const dirty = useRef(false);

  const load = useMemo(
    () => () => {
      if (!staff) return;
      getDepartmentSetup(staff, dept)
        .then((s) => {
          dirty.current = false;
          setData(s.data);
          setLoadError(null);
        })
        .catch((e: unknown) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load the setup."));
    },
    [staff, dept],
  );
  useEffect(() => load(), [load]);

  // Autosave this department's rows a moment after the last edit.
  useEffect(() => {
    if (!staff || !data || !dirty.current) return;
    const timer = setTimeout(() => {
      setSave({ kind: "saving" });
      saveDepartmentSetup(staff, dept, data)
        .then((r) => {
          dirty.current = false;
          setSave({ kind: "saved", at: r.updated_at, ignored: r.ignored });
          if (r.ignored.length) load(); // show the setup as the server kept it
        })
        .catch((e: unknown) => setSave({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't save. Your changes are still here; try again." }));
    }, 1200);
    return () => clearTimeout(timer);
  }, [data, staff, dept, load]);

  const specs = useMemo(
    () => ({
      rooms: scopeSpec(roomsTable, dept, byDepartment),
      teachers: scopeSpec(teachersTable, dept, byDepartment),
      sections: scopeSpec(sectionsTable, dept, byDepartment),
      subjects: scopeSpec(subjectsTable, dept, byDepartment),
      assignments: scopeSpec(assignmentsTable, dept, assignmentOwner, (row, d) => ({
        ...row,
        section_id: d.sections.find((s) => s.department_id === dept)?.id ?? row.section_id,
      })),
    }),
    [dept],
  );

  if (incharge === undefined || hod === undefined || opening.opening) return <p className="p-8 text-ink-soft">Opening…</p>;
  if (!member || !staff)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Department setup</h1>
          <p className="text-lg text-ink-soft">
            This page is for a department&apos;s HOD or timetable in-charge. Open the link you were given by your HOD or the timetable
            admin.
          </p>
          {opening.error && <p className="font-semibold text-err">{opening.error}</p>}
        </main>
      </>
    );

  const edit = (d: CollegeData) => {
    dirty.current = true;
    setData(d);
  };
  const isHod = member.role === "hod";
  const deptName = member.department_name || dept;

  return (
    <>
      <AppNav collegeName={member.college_name} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="text-sm text-ink-soft">
              {isHod ? "HOD" : "Timetable in-charge"}: {member.name}
            </p>
            <h1 className="text-2xl font-bold sm:text-3xl">{deptName} setup</h1>
          </div>
          <p role={save.kind === "error" ? "alert" : undefined} className={`text-sm ${save.kind === "error" ? "font-semibold text-err" : "text-ink-soft"}`}>
            {save.kind === "saving"
              ? "Saving…"
              : save.kind === "saved"
                ? `Saved online ${new Date(save.at).toLocaleTimeString(undefined, { timeStyle: "short" })}`
                : save.kind === "error"
                  ? save.message
                  : "Changes save online automatically."}
          </p>
        </div>

        {save.kind === "saved" && save.ignored.length > 0 && (
          <div role="status" className="rounded-md border border-line bg-blush px-4 py-3">
            <p className="font-semibold">Some changes weren&apos;t saved, because they belong to another department or the admin:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {save.ignored.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {loadError && <p className="font-semibold text-err">{loadError}</p>}
        {!data && !loadError && <p className="text-ink-soft">Loading the setup…</p>}

        {data && (
          <>
            <details className="rounded-md border border-line bg-paper p-4">
              <summary className="cursor-pointer font-semibold">
                The college week: {data.settings.days.join(", ") || "no days yet"}, {data.settings.periods_per_day} periods (set by the
                timetable admin)
              </summary>
              <div className="mt-3">
                <DayPreview settings={data.settings} />
              </div>
            </details>

            <nav aria-label="Department setup steps" className="overflow-x-auto">
              <div role="group" className="flex min-w-max rounded-md border border-line bg-paper p-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded px-4 py-2 text-sm font-semibold ${tab === t.id ? "bg-sky/50" : "hover:bg-blush"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </nav>

            {tab === "rooms" && (
              <>
                <p className="hint max-w-3xl">
                  {deptName}&apos;s own rooms. Shared rooms (like a lecture theatre) are set by the admin. To use another department&apos;s
                  room, ask its HOD below.
                </p>
                <DataTable spec={specs.rooms} data={data} onChange={edit} emptyText={`${deptName} has no rooms of its own yet.`} />
                <RoomSharing staff={staff} dept={dept} data={data} canDecide={isHod} onShared={load} />
              </>
            )}
            {tab === "teachers" && (
              <DataTable spec={specs.teachers} data={data} onChange={edit} emptyText={`No ${deptName} teachers yet. Add them, or paste the staff list from Excel.`} />
            )}
            {tab === "sections" && (
              <DataTable spec={specs.sections} data={data} onChange={edit} emptyText={`No ${deptName} sections yet, e.g. ${dept}-3A.`} />
            )}
            {tab === "subjects" && (
              <div className="flex flex-col gap-8">
                <DataTable spec={specs.subjects} data={data} onChange={edit} emptyText={`No ${deptName} subjects yet.`} />
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-bold">Who teaches what in {deptName}</h2>
                  <p className="hint">
                    One row for each subject a {deptName} section studies, with its teacher. Teachers from other departments can be chosen
                    too. Open electives are set up by the timetable admin.
                  </p>
                  <DataTable spec={specs.assignments} data={data} onChange={edit} emptyText="Nothing assigned yet. Paste your load sheet or add rows." />
                </div>
              </div>
            )}
            {tab === "ready" && <ReadyPanel staff={staff} dept={dept} deptName={deptName} data={data} />}

            {isHod && (
              <InchargeLink
                staff={staff}
                dept={dept}
                teachers={data.teachers.filter((t) => t.department_id === dept).map((t) => ({ id: t.id, name: t.name || t.id }))}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}

function ReadyPanel({ staff, dept, deptName, data }: { staff: Staff; dept: string; deptName: string; data: CollegeData }) {
  const [status, setStatus] = useState<DepartmentState[] | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    departmentStatus(staff)
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Couldn't load the departments."));
    checkCollege(data)
      .then((r) => setProblems(r.problems))
      .catch(() => setProblems(null));
  }, [staff, data]);

  const mine = status?.find((s) => s.department_id === dept);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await setDepartmentReady(staff, dept, !mine?.ready);
      setStatus((all) => all?.map((s) => (s.department_id === dept ? { ...s, ready: r.ready, updated_at: r.updated_at, updated_by: r.updated_by } : s)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
        <h2 className="text-lg font-bold">Is {deptName} ready?</h2>
        <p className="hint max-w-2xl">
          When {deptName}&apos;s rooms, teachers, sections and subjects are complete, mark it ready. The timetable admin generates the
          college timetable once every department is ready.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={mine?.ready ? "btn-quiet" : "btn-primary"} disabled={busy || !status} onClick={toggle}>
            {mine?.ready ? "Mark as not ready" : `Mark ${deptName} ready`}
          </button>
          {mine?.ready && <span className="font-semibold text-ok">Ready{mine.updated_by ? `, marked by ${mine.updated_by}` : ""}</span>}
        </div>
        {error && <p className="font-semibold text-err">{error}</p>}
      </div>

      {status && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">All departments</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {status.map((s) => (
              <li key={s.department_id} className="rounded-md border border-line bg-paper px-3 py-2">
                <span className="font-semibold">{s.department_name}</span>{" "}
                <span className={s.ready ? "text-ok" : "text-ink-soft"}>{s.ready ? "ready" : "not ready yet"}</span>
                <span className="block text-sm text-ink-soft">
                  HOD: {s.hod ?? "not set"}. In-charge: {s.incharge ?? "not set"}.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Checks for the whole college</h3>
        {problems === null ? (
          <p className="hint">Checking…</p>
        ) : problems.length === 0 ? (
          <p className="font-semibold text-ok">Everything fits: every class has a teacher, a room and enough time.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {problems.map((p, i) => (
              <li key={i} className="border-l-4 border-err bg-paper px-3 py-2">
                <p className="font-semibold text-err">{p.message}</p>
                {p.suggestion && <p className="hint">{p.suggestion}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
