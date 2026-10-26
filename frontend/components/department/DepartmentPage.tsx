"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppNav from "@/components/AppNav";
import DataTable from "@/components/setup/DataTable";
import DayPreview from "@/components/setup/DayPreview";
import { ApiError, checkCollege } from "@/lib/api";
import {
  departmentStatus,
  getDepartmentSetup,
  reviewDepartment,
  saveDepartmentSetup,
  STATE_TEXT,
  submitDepartment,
  type DepartmentState,
  type ReviewState,
  type Staff,
} from "@/lib/departments";
import { useMemberAccess, useOpenMemberLink } from "@/lib/members";
import { assignmentOwner, byDepartment, scopeSpec } from "@/lib/scope";
import { assignmentsTable, roomsTable, sectionsTable, subjectsTable, teachersTable } from "@/lib/tables";
import type { CollegeData, Problem } from "@/lib/types";
import InchargeLink from "./InchargeLink";
import RoomSharing from "./RoomSharing";

type Tab = "rooms" | "teachers" | "sections" | "subjects" | "review";
const tabs = (isHod: boolean): { id: Tab; label: string }[] => [
  { id: "rooms", label: "Rooms" },
  { id: "teachers", label: "Teachers" },
  { id: "sections", label: "Sections" },
  { id: "subjects", label: "Subjects & classes" },
  { id: "review", label: isHod ? "Check & approve" : "Check & send to HOD" },
];

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string; ignored: string[]; reopened: boolean }
  | { kind: "error"; message: string };

const STATE_STYLE: Record<ReviewState, string> = {
  draft: "bg-cream text-ink",
  submitted: "bg-sky/40 text-navy",
  approved: "bg-mint text-ok",
  returned: "bg-blush text-err",
};

function StatePill({ state }: { state: ReviewState }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${STATE_STYLE[state]}`}>{STATE_TEXT[state]}</span>;
}

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
  const [status, setStatus] = useState<DepartmentState[] | null>(null);
  const dirty = useRef(false);

  const loadStatus = useMemo(
    () => () => {
      if (!staff) return;
      departmentStatus(staff)
        .then(setStatus)
        .catch(() => setStatus(null));
    },
    [staff],
  );
  useEffect(() => loadStatus(), [loadStatus]);

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
          setSave({ kind: "saved", at: r.updated_at, ignored: r.ignored, reopened: r.reopened });
          if (r.ignored.length) load(); // show the setup as the server kept it
          if (r.reopened) loadStatus();
        })
        .catch((e: unknown) => setSave({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't save. Your changes are still here; try again." }));
    }, 1200);
    return () => clearTimeout(timer);
  }, [data, staff, dept, load, loadStatus]);

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
            This page is for a department&apos;s HOD or timetable in-charge. Open the link you were given by your HOD or the Dean.
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
  const mine = status?.find((s) => s.department_id === dept);

  return (
    <>
      <AppNav collegeName={member.college_name} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <p className="text-sm text-ink-soft">
              {isHod ? "HOD" : "Timetable in-charge"}: {member.name}
            </p>
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold sm:text-3xl">
              {deptName} setup {mine && <StatePill state={mine.state} />}
            </h1>
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
            <p className="font-semibold">Some changes weren&apos;t saved, because they belong to another department or the Dean:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {save.ignored.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {save.kind === "saved" && save.reopened && (
          <p role="status" className="rounded-md border border-line bg-cream px-4 py-3">
            <span className="font-semibold">{deptName} is back to draft,</span> because it changed after it was sent to the HOD.{" "}
            {isHod ? "Approve it again when you're happy with it." : "Send it to the HOD again when it's done."}
          </p>
        )}
        {mine?.state === "returned" && tab !== "review" && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-blush px-4 py-3">
            <p className="mr-auto">
              <span className="font-semibold">Sent back by {mine.updated_by || "the HOD"}:</span> “{mine.note}”
            </p>
            <button type="button" className="btn-quiet" onClick={() => setTab("review")}>
              {isHod ? "Review" : "Send it again"}
            </button>
          </div>
        )}
        {loadError && <p className="font-semibold text-err">{loadError}</p>}
        {!data && !loadError && <p className="text-ink-soft">Loading the setup…</p>}

        {data && (
          <>
            <details className="rounded-md border border-line bg-paper p-4">
              <summary className="cursor-pointer font-semibold">
                The college week: {data.settings.days.join(", ") || "no days yet"}, {data.settings.periods_per_day} periods (set by the
                Dean)
              </summary>
              <div className="mt-3">
                <DayPreview settings={data.settings} />
              </div>
            </details>

            <nav aria-label="Department setup steps" className="overflow-x-auto">
              <div role="group" className="flex min-w-max rounded-md border border-line bg-paper p-1">
                {tabs(isHod).map((t) => (
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
                  {deptName}&apos;s own rooms. Shared rooms (like a lecture theatre) are set by the Dean. To use another department&apos;s
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
                    too. Open electives are set up by the Dean.
                  </p>
                  <DataTable spec={specs.assignments} data={data} onChange={edit} emptyText="Nothing assigned yet. Paste your load sheet or add rows." />
                </div>
              </div>
            )}
            {tab === "review" && (
              <ReviewPanel staff={staff} dept={dept} deptName={deptName} isHod={isHod} data={data} status={status} onChange={setStatus} />
            )}

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

const when = (at: string | null) => (at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

function ReviewPanel({
  staff,
  dept,
  deptName,
  isHod,
  data,
  status,
  onChange,
}: {
  staff: Staff;
  dept: string;
  deptName: string;
  isHod: boolean;
  data: CollegeData;
  status: DepartmentState[] | null;
  onChange: (all: DepartmentState[]) => void;
}) {
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [sendingBack, setSendingBack] = useState(false);

  useEffect(() => {
    checkCollege(data)
      .then((r) => setProblems(r.problems))
      .catch(() => setProblems(null));
  }, [data]);

  const mine = status?.find((s) => s.department_id === dept);
  const act = async (call: () => Promise<DepartmentState>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      onChange(status?.map((s) => (s.department_id === dept ? r : s)) ?? [r]);
      setNote("");
      setSendingBack(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => act(() => submitDepartment(staff, dept, note));
  const approve = () => act(() => reviewDepartment(staff, dept, true, note));
  const sendBack = () => act(() => reviewDepartment(staff, dept, false, note));

  const state = mine?.state ?? "draft";
  const by = mine?.updated_by ? ` by ${mine.updated_by}` : "";
  const DONE: Record<ReviewState, string> = { draft: "", submitted: "Sent to the HOD", approved: "Approved", returned: "Sent back" };
  const problemCount = problems?.length ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
        <h2 className="flex flex-wrap items-center gap-3 text-lg font-bold">
          {deptName}&apos;s data <StatePill state={state} />
        </h2>
        <p className="hint max-w-2xl">
          The timetable in-charge prepares {deptName}&apos;s rooms, teachers, sections and classes and sends them to the HOD. The HOD
          approves them, or sends them back with a note. The Dean generates the college timetable once every department is approved.
        </p>

        {mine && state !== "draft" && (
          <p>
            {DONE[state]}
            {by}
            {mine.updated_at ? `, ${when(mine.updated_at)}` : ""}.
            {mine.note && <span className="block">{state === "returned" ? "What to fix" : "Note"}: “{mine.note}”</span>}
          </p>
        )}
        {mine && state === "draft" && mine.note && <p className="text-ink-soft">{mine.note}</p>}

        {problemCount > 0 && (state === "draft" || state === "returned" || (isHod && state === "submitted")) && (
          <p className="text-sm">
            The checks below found {problemCount} problem{problemCount === 1 ? "" : "s"} in the whole college. Fix any that are about{" "}
            {deptName} first.
          </p>
        )}

        {/* What this person can do next. */}
        {!isHod && (state === "draft" || state === "returned") && (
          <div className="flex flex-col gap-2">
            <label className="field-label" htmlFor="note-to-hod">
              Note for the HOD (optional)
            </label>
            <textarea id="note-to-hod" className="field max-w-xl" rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            <div>
              <button type="button" className="btn-primary" disabled={busy || !status} onClick={submit}>
                {busy ? "Sending…" : state === "returned" ? "Send to the HOD again" : "Send to the HOD for approval"}
              </button>
            </div>
          </div>
        )}
        {!isHod && state === "submitted" && (
          <p className="hint">Waiting for the HOD. If you change anything now, it comes back to you as a draft.</p>
        )}
        {state === "approved" && (
          <p className="font-semibold text-ok">
            Approved. The Dean can now include {deptName} in the timetable. Changing anything puts it back to draft.
          </p>
        )}

        {isHod && state !== "approved" && !sendingBack && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy || !status} onClick={approve}>
              {busy ? "Saving…" : `Approve ${deptName}'s data`}
            </button>
            {state === "submitted" && (
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => setSendingBack(true)}>
                Send back with a note
              </button>
            )}
          </div>
        )}
        {isHod && state === "approved" && !sendingBack && (
          <div>
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => setSendingBack(true)}>
              Take back the approval and send a note
            </button>
          </div>
        )}
        {isHod && sendingBack && (
          <div className="flex flex-col gap-2">
            <label className="field-label" htmlFor="send-back-note">
              What should the in-charge fix?
            </label>
            <textarea
              id="send-back-note"
              className="field max-w-xl"
              rows={3}
              value={note}
              maxLength={500}
              placeholder="e.g. CS301 needs its 2-period lab, and Dr. Kaur can't teach on Fridays."
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy || !note.trim()} onClick={sendBack}>
                {busy ? "Sending…" : "Send back"}
              </button>
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => setSendingBack(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="font-semibold text-err">
            {error}
          </p>
        )}
        {!status && <p className="hint">Loading where each department is…</p>}
      </div>

      {status && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">All departments</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {status.map((s) => (
              <li key={s.department_id} className="flex flex-col gap-1 rounded-md border border-line bg-paper px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.department_name}</span> <StatePill state={s.state} />
                </span>
                {s.department_id === dept && (
                  <span className="text-sm text-ink-soft">
                    HOD: {s.hod ?? "not set"}. In-charge: {s.incharge ?? "not set"}.
                  </span>
                )}
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
