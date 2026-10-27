"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AppNav from "@/components/AppNav";
import MoreMenu from "@/components/ui/MoreMenu";
import { AdminLinkNotice, CloudSave, useOpenAdminLink } from "@/components/share/CloudSave";
import { signOut } from "@/lib/accounts";
import { getAdminCollege, readAdminAccess, useAdminAccess } from "@/lib/cloud";
import { clearTimetable } from "@/lib/result";
import { ApiError, getSample } from "@/lib/api";
import { downloadWorkbook, importWorkbook, readSpreadsheet, sheetsIn } from "@/lib/excel";
import { useAccess } from "@/lib/access";
import { useMemberAccess } from "@/lib/members";
import { ensureAwake } from "@/lib/server";
import { useCollege } from "@/lib/store";
import { START_TEMPLATES } from "@/lib/templates";
import type { CollegeData, StepId } from "@/lib/types";
import ImportReport, { type Report } from "./ImportReport";
import StepReview from "./StepReview";
import { StepRooms, StepSections, StepSubjects, StepTeachers } from "./StepTables";
import StepWeek from "./StepWeek";
import PageLoading from "@/components/ui/PageLoading";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

interface StepInfo {
  id: StepId;
  title: string;
  hint: string;
  count: (d: CollegeData) => string;
}

const STEPS: StepInfo[] = [
  {
    id: "week",
    title: "College & week",
    hint: "Set up the days, periods and breaks once. Every timetable is built on this grid. Then list your departments.",
    count: (d) => plural(d.settings.days.length, "day"),
  },
  {
    id: "rooms",
    title: "Rooms",
    hint: "List every room with its seats. Mark a room with a department if only that department uses it; otherwise it’s shared.",
    count: (d) => plural(d.rooms.length, "room"),
  },
  {
    id: "teachers",
    title: "Teachers",
    hint: "Use short codes (like HK for Dr. Harpreet Kaur). Teachers can teach in any department, not just their own.",
    count: (d) => plural(d.teachers.length, "teacher"),
  },
  {
    id: "sections",
    title: "Sections",
    hint: "A section is a group of students who sit together, like CSE-3A. Students count must fit the room.",
    count: (d) => plural(d.sections.length, "section"),
  },
  {
    id: "subjects",
    title: "Subjects",
    hint: "Give each subject its lectures and lab periods a week, then say which teacher takes it for each section.",
    count: (d) => plural(d.subjects.length, "subject"),
  },
  {
    id: "review",
    title: "Check & generate",
    hint: "We check that everything can fit before generating, and tell you exactly what to change if it can’t.",
    count: () => "",
  },
];

/** Setup opened by a student, teacher or department (by mistake): say where their page is. */
function ViewerNotice({ code, department, onNewCollege }: { code: string | null; department: boolean; onNewCollege: () => void }) {
  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-5 px-4 py-16">
        <h1 className="text-3xl font-bold">Setup is for the Dean’s office</h1>
        <p className="text-lg text-ink-soft">
          {department ? (
            "This is where the Dean sets up the whole college. Your department’s rooms, teachers and classes are on the Department page."
          ) : (
            <>
              This is where the Dean sets up the college’s rooms, teachers and subjects. To see your classes
              {code && (
                <>
                  {" "}
                  for college <span className="font-semibold text-ink">{code}</span>
                </>
              )}
              , open your timetable.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={department ? "/department" : "/my"} className="btn-primary !px-5 !py-3 !text-base">
            {department ? "Open my department" : "Open my timetable"}
          </Link>
          <button type="button" className="btn-quiet !px-5 !py-3 !text-base" onClick={onNewCollege}>
            I’m setting up a new college
          </button>
        </div>
      </main>
    </>
  );
}

function TemplatePicker({ onPick }: { onPick: (d: CollegeData) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSample = async () => {
    setLoading(true);
    setError(null);
    try {
      onPick(await getSample());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the sample.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold sm:text-4xl">Set up your college</h1>
        <p className="max-w-2xl text-lg text-ink-soft">
          Pick the closest starting point. It fills in periods, breaks and room types. You’ll choose your own working
          days next, and you can change everything.
        </p>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {START_TEMPLATES.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onPick(t.build())}
              className="flex h-full w-full flex-col gap-2 rounded-md border border-line bg-paper p-5 text-left hover:border-navy hover:bg-sky/15"
            >
              <span className="text-lg font-bold">{t.title}</span>
              <span className="text-sm text-ink-soft">{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
        <button type="button" className="btn-quiet" onClick={loadSample} disabled={loading}>
          {loading ? "Loading sample…" : "Load sample college"}
        </button>
        <p className="hint">A complete engineering college with 5 sections, to see how everything works.</p>
        {error && <p className="w-full font-semibold text-err">{error}</p>}
      </div>
    </main>
  );
}

function Stepper({ current, data, onGo }: { current: StepId; data: CollegeData; onGo: (s: StepId) => void }) {
  // On a phone the steps scroll sideways: keep the current one in view.
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current]);
  return (
    <nav aria-label="Setup steps" className="overflow-x-auto">
      <ol className="flex min-w-max border-y border-line bg-paper">
        {STEPS.map((s, i) => {
          const active = s.id === current;
          return (
            <li key={s.id} className="flex-1 border-l border-line first:border-l-0">
              <button
                type="button"
                ref={active ? activeRef : undefined}
                onClick={() => onGo(s.id)}
                aria-current={active ? "step" : undefined}
                className={`flex w-full min-w-36 flex-col items-start px-4 py-2.5 text-left ${active ? "bg-sky" : "hover:bg-blush/60"}`}
              >
                <span className={`text-xs ${active ? "text-ink" : "text-ink-soft"}`}>Step {i + 1}</span>
                <span className="font-bold">{s.title}</span>
                <span className={`text-xs ${active ? "text-ink" : "text-ink-soft"}`}>{s.count(data) || " "}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The step in the address bar (/setup?step=rooms), so reloading or pressing Back keeps your place. */
function stepFromUrl(): StepId | null {
  if (typeof window === "undefined") return null;
  const s = new URLSearchParams(window.location.search).get("step");
  return STEPS.some((x) => x.id === s) ? (s as StepId) : null;
}

export default function SetupWizard() {
  const { data, loaded, setData, replaceData } = useCollege();
  const [step, setStep] = useState<StepId>(() => stepFromUrl() ?? "week");
  useEffect(() => {
    const onBack = () => setStep(stepFromUrl() ?? "week");
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  const [report, setReport] = useState<Report | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A free server may be asleep: start waking it now, so it's ready by the checks step.
  useEffect(() => {
    void ensureAwake();
  }, []);

  // Opened from the admin link (/setup#college=…&key=…): load the college saved online.
  const opening = useOpenAdminLink(loaded, data !== null, replaceData);
  const [noticeClosed, setNoticeClosed] = useState(false);
  const access = useAccess();
  const hodLink = useMemberAccess("hod");
  const inchargeLink = useMemberAccess("incharge");
  const department = Boolean(hodLink || inchargeLink);
  const [newCollege, setNewCollege] = useState(false);
  const notice = noticeClosed ? null : <AdminLinkNotice state={opening} onClose={() => setNoticeClosed(true)} />;

  // The Dean signed in on a device with no setup copy: bring the one saved online.
  const admin = useAdminAccess();
  const [online, setOnline] = useState<"idle" | "loading" | "done">("idle");
  const adminCode = admin?.code;
  const adminKey = admin?.key;
  useEffect(() => {
    if (!loaded || data || !adminCode || !adminKey || online !== "idle") return;
    setOnline("loading"); // eslint-disable-line react-hooks/set-state-in-effect -- start of a one-time load
    getAdminCollege({ code: adminCode, key: adminKey })
      .then((c) => {
        if (c.data) replaceData(c.data);
      })
      .catch(() => undefined) // offline or asleep: the template picker shows, and CloudSave reports it
      .finally(() => setOnline("done"));
  }, [loaded, data, adminCode, adminKey, online, replaceData]);

  if (!loaded || opening.kind === "loading" || access === undefined || online === "loading") return <PageLoading />;
  // A student, teacher or department who reached Setup by mistake.
  if (!data && !access.staff && (access.viewing || department) && !newCollege)
    return <ViewerNotice code={access.viewing} department={department} onNewCollege={() => setNewCollege(true)} />;
  if (!data)
    return (
      <>
        <AppNav />
        {notice}
        <TemplatePicker
          onPick={(d) => {
            replaceData(d);
            setReport(null);
            window.history.replaceState(null, "", window.location.pathname); // back to step 1, in the address bar too
            setStep("week");
          }}
        />
      </>
    );

  const index = STEPS.findIndex((s) => s.id === step);
  const info = STEPS[index];
  const onChange = (d: CollegeData) => setData(() => d);
  const go = (s: StepId) => {
    if (s !== step) window.history.pushState(null, "", `${window.location.pathname}?step=${s}`);
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  // A clean start: this device forgets the setup, its timetable and who is signed in.
  // Nothing online is deleted; signing in again brings that college back.
  const startNew = () => {
    const online = readAdminAccess();
    const message = online
      ? `Start a new college? This browser forgets ${data.name || online.code}: its setup, its timetable and your sign-in here. Nothing saved online is deleted; sign in again to come back to it.`
      : "Start a new college? Everything entered so far is cleared from this browser.";
    if (!window.confirm(message)) return;
    signOut(); // first, so autosave can't upload the empty setup over the online copy
    clearTimetable();
    replaceData(null);
    setReport(null);
    window.history.replaceState(null, "", window.location.pathname);
    setStep("week");
    window.scrollTo({ top: 0 });
  };

  const importAll = async (file: File) => {
    try {
      const sheets = await readSpreadsheet(file);
      // Re-uploading a corrected file must be able to remove rows too, not only add and update.
      const tables = sheetsIn(sheets);
      const hasRows = data.rooms.length + data.teachers.length + data.sections.length + data.subjects.length > 0;
      const replace =
        !hasRows ||
        window.confirm(
          `Replace ${tables.join(", ") || "these tables"} with what's in "${file.name}"?\n\n` +
            "OK: the setup will match the file (rows that aren't in the file are removed).\n" +
            "Cancel: keep everything and only add new rows or update matching ones.",
        );
      const r = importWorkbook(sheets, data, replace ? "replace" : "merge");
      onChange(r.data);
      setReport({ source: file.name, summary: r.summary, errors: r.errors });
    } catch {
      setReport({
        source: file.name,
        summary: [],
        errors: [{ sheet: "Workbook", row: 0, message: "Couldn't read this file. Save it as .xlsx and try again." }],
      });
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <AppNav collegeName={data.name} />
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        {/* The college name is already in the menu bar above. */}
        <p className="mr-auto text-sm font-semibold text-ink-soft">Timetable setup</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="sr-only"
          aria-label="Import the whole setup workbook"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importAll(f);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn-quiet" onClick={startNew}>
          Start a new college
        </button>
        {/* Less-used actions in one menu, so the steps come first. */}
        <MoreMenu
          label="Excel"
          actions={[
            { label: "Download Excel workbook", onClick: () => downloadWorkbook(data) },
            { label: "Import workbook", onClick: () => fileRef.current?.click() },
          ]}
        />
      </header>

      {notice}
      <CloudSave data={data} replaceData={replaceData} />

      <Stepper current={step} data={data} onGo={go} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold sm:text-3xl">{info.title}</h1>
          <p className="max-w-3xl border-l-4 border-sky pl-3 text-ink-soft">{info.hint}</p>
        </div>

        {report && <ImportReport report={report} onClose={() => setReport(null)} />}

        {step === "week" && <StepWeek data={data} onChange={onChange} />}
        {step === "rooms" && <StepRooms data={data} onChange={onChange} />}
        {step === "teachers" && <StepTeachers data={data} onChange={onChange} />}
        {step === "sections" && <StepSections data={data} onChange={onChange} />}
        {step === "subjects" && <StepSubjects data={data} onChange={onChange} />}
        {step === "review" && <StepReview data={data} goTo={go} />}
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <button type="button" className="btn-quiet" disabled={index === 0} onClick={() => go(STEPS[index - 1].id)}>
            Back
          </button>
          <span className="hint ml-auto hidden sm:inline">{admin ? "Saved online automatically" : "Saved automatically in this browser"}</span>
          {index < STEPS.length - 1 && (
            <button type="button" className="btn-primary" onClick={() => go(STEPS[index + 1].id)}>
              Next: {STEPS[index + 1].title}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
