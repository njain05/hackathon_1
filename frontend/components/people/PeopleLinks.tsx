"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import AppNav from "@/components/AppNav";
import { CopyField } from "@/components/share/CloudSave";
import { ApiError } from "@/lib/api";
import {
  type AccountRow,
  type MadeAccount,
  ROLE_NAME,
  createAccount,
  createAccounts,
  deleteAccount,
  listAccounts,
  resetPassword,
} from "@/lib/accounts";
import { type AdminAccess, getAdminCollege, useAdminAccess } from "@/lib/cloud";
import {
  type HeadOut,
  type TeacherLinkOut,
  listHeads,
  listTeacherLinks,
  makeHead,
  makeTeacherLink,
  memberLink,
  saveMemberLink,
  useSavedMemberLinks,
} from "@/lib/members";
import type { CollegeData } from "@/lib/types";
import PageLoading from "@/components/ui/PageLoading";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** A username from a code: lowercase, and only the characters a username may have. */
const asUsername = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");

/** Rows pasted from Excel: "roll number, name, section" (tabs or commas); a header row is skipped. */
function parseStudents(text: string, sections: CollegeData["sections"], fallback: string) {
  const find = (v: string) => {
    const t = v.trim().toLowerCase();
    return sections.find((s) => s.id.toLowerCase() === t || s.name.toLowerCase() === t)?.id ?? v.trim();
  };
  return text
    .split(/\r?\n/)
    .map((line) => line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim()))
    .filter((cells) => cells[0] && !/^roll|^user/i.test(cells[0]))
    .map(([roll, name = "", section = ""]) => ({
      username: asUsername(roll),
      name: name || roll,
      section_id: section ? find(section) : fallback,
    }));
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** New passwords, shown once: download or print them before leaving the page. */
function NewPasswords({ code, made, onDone }: { code: string; made: MadeAccount[]; onDone: () => void }) {
  const download = () => {
    const rows = [["Name", "Role", "College code", "Username", "Password"], ...made.map((m) => [m.name, ROLE_NAME[m.role], code, m.username, m.password])];
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sign-ins-${code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section aria-label="New passwords" className="flex flex-col gap-3 rounded-md border-2 border-err/40 bg-blush p-4 print:border-0 print:bg-transparent print:p-0">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <h2 className="mr-auto text-xl font-bold">New passwords: shown only once</h2>
        <button type="button" className="btn-primary" onClick={download}>
          Download as a spreadsheet (CSV)
        </button>
        <button type="button" className="btn-quiet" onClick={() => window.print()}>
          Print
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => window.confirm("Hide these passwords? You can't see them again (you can reset a password).") && onDone()}
        >
          I’ve given them out
        </button>
      </div>
      <p className="print:hidden">
        Give each person their own row (print and cut, or send it privately). They sign in with the college code{" "}
        <strong>{code}</strong>, their username and this password, and can change the password after signing in.
      </p>
      <p className="hidden text-lg font-bold print:block">Sign-ins for college code {code}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-paper text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="p-2">Name</th>
              <th className="p-2">Role</th>
              <th className="p-2">Username</th>
              <th className="p-2">Password</th>
            </tr>
          </thead>
          <tbody>
            {made.map((m) => (
              <tr key={m.username} className="border-b border-line/70">
                <td className="p-2">{m.name}</td>
                <td className="p-2">{ROLE_NAME[m.role]}</td>
                <td className="p-2 font-mono">{m.username}</td>
                <td className="p-2 font-mono font-bold">{m.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One person's sign-in: who, and Reset password / Remove. */
function AccountLine({ row, busy, onReset, onRemove }: { row: AccountRow; busy: boolean; onReset: () => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto">
        <span className="font-semibold">{row.name}</span> <span className="text-ink-soft">signs in as</span>{" "}
        <span className="font-mono">{row.username}</span>
      </span>
      <button type="button" className="btn-quiet !py-1" disabled={busy} onClick={onReset}>
        Reset password
      </button>
      <button type="button" className="btn-quiet !py-1" disabled={busy} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

/** Make a sign-in for a department's HOD or timetable in-charge. */
function StaffForm({ role, dept, busy, onMake }: { role: "hod" | "incharge"; dept: string; busy: boolean; onMake: (name: string, username: string) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState(asUsername(`${role}.${dept}`));
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onMake(name.trim(), username.trim());
      }}
    >
      <label htmlFor={`${id}-n`} className="flex flex-col gap-1">
        <span className="field-label">{ROLE_NAME[role]}’s name</span>
        <input id={`${id}-n`} className="field" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor={`${id}-u`} className="flex flex-col gap-1">
        <span className="field-label">Username</span>
        <input id={`${id}-u`} className="field" required maxLength={60} value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <button type="submit" className="btn-quiet" disabled={busy || !name.trim() || !username.trim()}>
        Make {ROLE_NAME[role]} sign-in
      </button>
    </form>
  );
}

/** Admin: everyone's sign-in (HODs, in-charges, teachers, students), plus the older private links. */
export default function PeopleLinks() {
  const admin = useAdminAccess();
  const [data, setData] = useState<CollegeData | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [made, setMade] = useState<MadeAccount[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!admin) return;
    Promise.all([getAdminCollege(admin), listAccounts(admin)])
      .then(([c, list]) => {
        setData(c.data);
        setAccounts(list);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, "Couldn't load the people.")));
  }, [admin]);

  useEffect(() => {
    load();
  }, [load]);

  // Passwords are only on this page: warn before leaving with some not yet given out.
  useEffect(() => {
    if (!made.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [made.length]);

  if (admin === undefined) return <PageLoading />;
  if (!admin)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">People &amp; sign-ins</h1>
          <p className="text-lg text-ink-soft">Only the Dean can make sign-ins. Sign in as the Dean first.</p>
          <Link href="/login" className="btn-primary w-fit">
            Sign in
          </Link>
        </main>
      </>
    );

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e, fallback));
    } finally {
      setBusy(false);
      load();
    }
  };
  const remember = (m: MadeAccount[]) => setMade((old) => [...m, ...old.filter((o) => !m.some((n) => n.username === o.username))]);

  const reset = (row: AccountRow) =>
    run(async () => {
      if (!window.confirm(`Give ${row.name} a new password? Their old password stops working.`)) return;
      remember([await resetPassword(admin, row.username)]);
    }, "Couldn't reset the password.");
  const remove = (row: AccountRow) =>
    run(async () => {
      if (!window.confirm(`Remove ${row.name}'s sign-in? They can't sign in any more (you can make a new one later).`)) return;
      await deleteAccount(admin, row.username);
      setMade((old) => old.filter((m) => m.username !== row.username));
    }, "Couldn't remove the sign-in.");
  const line = (row: AccountRow) => <AccountLine key={row.username} row={row} busy={busy} onReset={() => reset(row)} onRemove={() => remove(row)} />;

  const all = accounts ?? [];
  const teacherAccount = (id: string) => all.find((a) => a.role === "teacher" && a.teacher_id === id);
  const teachersWithout = data?.teachers.filter((t) => !teacherAccount(t.id)) ?? [];
  const students = all.filter((a) => a.role === "student");

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1 print:hidden">
          <h1 className="text-2xl font-bold sm:text-3xl">People &amp; sign-ins</h1>
          <p className="text-ink-soft">
            Everyone signs in with the college code <strong>{admin.code}</strong>, their own username and a password, and
            sees only what their role allows. Make the sign-ins here; each new password is shown once, to download or
            print.
          </p>
        </div>
        {error && (
          <p role="alert" className="font-semibold text-err print:hidden">
            {error}
          </p>
        )}

        {made.length > 0 && <NewPasswords code={admin.code} made={made} onDone={() => setMade([])} />}
        {problems.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 rounded-md border border-line bg-blush p-3 print:hidden">
            <p className="font-semibold">Some rows were skipped:</p>
            <ul className="list-disc pl-5 text-sm">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <button type="button" className="btn-quiet w-fit !py-1" onClick={() => setProblems([])}>
              OK
            </button>
          </div>
        )}

        {!accounts && !error && <p className="text-ink-soft">Loading…</p>}
        {accounts && !data && (
          <p className="rounded-md border border-line bg-paper p-4 print:hidden">
            Save the setup online first (departments, teachers and sections), then come back to make sign-ins.{" "}
            <Link href="/setup" className="font-semibold text-navy underline">
              Go to setup
            </Link>
          </p>
        )}

        {accounts && data && (
          <div className="flex flex-col gap-6 print:hidden">
            <section aria-label="Departments" className="flex flex-col gap-3">
              <div>
                <h2 className="text-xl font-bold">Heads of department and timetable in-charges</h2>
                <p className="text-ink-soft">
                  The HOD approves their department’s leave, room requests and timetable data. The in-charge enters the
                  department’s timetable data (the HOD can also choose them).
                </p>
              </div>
              {data.departments.length === 0 && <p className="text-ink-soft">No departments in the setup yet.</p>}
              {data.departments.map((d) => (
                <div key={d.id} className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
                  <span className="text-lg font-bold">
                    {d.name} <span className="text-base font-normal text-ink-soft">({d.id})</span>
                  </span>
                  {(["hod", "incharge"] as const).map((role) => {
                    const rows = all.filter((a) => a.role === role && a.department_id === d.id);
                    return (
                      <div key={role} className="flex flex-col gap-2 border-t border-line/70 pt-2">
                        <span className="field-label">{ROLE_NAME[role]}</span>
                        {rows.length ? (
                          rows.map(line)
                        ) : (
                          <StaffForm
                            role={role}
                            dept={d.id}
                            busy={busy}
                            onMake={(name, username) =>
                              run(async () => {
                                remember([await createAccount(admin, { role, username, name, department_id: d.id })]);
                              }, `Couldn't make the ${ROLE_NAME[role]} sign-in.`)
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>

            <section aria-label="Teachers" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-xl font-bold">Teachers</h2>
                {teachersWithout.length > 0 && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await createAccounts(
                          admin,
                          "teacher",
                          teachersWithout.map((t) => ({ username: asUsername(t.id), teacher_id: t.id })),
                        );
                        remember(r.made);
                        setProblems(r.problems);
                      }, "Couldn't make the teacher sign-ins.")
                    }
                  >
                    Make sign-ins for all {teachersWithout.length} teachers without one
                  </button>
                )}
              </div>
              <p className="text-ink-soft">
                A teacher’s username is their teacher code in small letters. Teachers see the timetables, ask their HOD for
                leave and ask for rooms.
              </p>
              {data.teachers.length === 0 && <p className="text-ink-soft">No teachers in the setup yet.</p>}
              <ul className="flex flex-col gap-2">
                {data.teachers.map((t) => {
                  const row = teacherAccount(t.id);
                  return (
                    <li key={t.id} className="rounded-md border border-line bg-paper p-3">
                      {row ? (
                        line(row)
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mr-auto">
                            <span className="font-semibold">{t.name}</span>{" "}
                            <span className="text-ink-soft">
                              ({t.id}, {t.department_id}): no sign-in yet
                            </span>
                          </span>
                          <button
                            type="button"
                            className="btn-quiet !py-1"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                remember([await createAccount(admin, { role: "teacher", username: asUsername(t.id), teacher_id: t.id })]);
                              }, "Couldn't make the sign-in.")
                            }
                          >
                            Make sign-in
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <Students admin={admin} data={data} students={students} busy={busy} run={run} remember={remember} setProblems={setProblems} line={line} />

            <details className="rounded-md border border-line bg-paper p-4">
              <summary className="cursor-pointer font-semibold">Old links (before sign-ins)</summary>
              <div className="pt-4">
                <OldLinks admin={admin} />
              </div>
            </details>
          </div>
        )}
      </main>
    </>
  );
}

function Students({
  admin,
  data,
  students,
  busy,
  run,
  remember,
  setProblems,
  line,
}: {
  admin: AdminAccess;
  data: CollegeData;
  students: AccountRow[];
  busy: boolean;
  run: (work: () => Promise<void>, fallback: string) => Promise<void>;
  remember: (m: MadeAccount[]) => void;
  setProblems: (p: string[]) => void;
  line: (row: AccountRow) => ReactNode;
}) {
  const [text, setText] = useState("");
  const [section, setSection] = useState(data.sections[0]?.id ?? "");
  const [filter, setFilter] = useState("");
  const id = useId();
  const rows = parseStudents(text, data.sections, section);
  const sectionName = (s: string | null) => data.sections.find((x) => x.id === s)?.name ?? s ?? "";
  const q = filter.trim().toLowerCase();
  const shown = q
    ? students.filter((s) => `${s.username} ${s.name} ${s.section_id ?? ""} ${sectionName(s.section_id)}`.toLowerCase().includes(q))
    : students;

  return (
    <section aria-label="Students" className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">Students</h2>
      <p className="text-ink-soft">
        Paste from Excel, one student per row: <strong>roll number, name, section</strong> (the section’s code or name).
        The roll number is the username. Students see only their own section’s timetable.
      </p>
      <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
        <label htmlFor={`${id}-paste`} className="field-label">
          Students
        </label>
        <textarea
          id={`${id}-paste`}
          className="field min-h-32 font-mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`21CSE001, Aman Gill, ${data.sections[0]?.id ?? "CSE-3A"}\n21CSE002, Simran Kaur, ${data.sections[0]?.id ?? "CSE-3A"}`}
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="field-label">Section for rows without one</span>
            <select className="field" value={section} onChange={(e) => setSection(e.target.value)}>
              {data.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || rows.length === 0}
            onClick={() =>
              run(async () => {
                const r = await createAccounts(admin, "student", rows);
                remember(r.made);
                setProblems(r.problems);
                // Keep only the skipped rows, to fix and try again.
                const left = rows.filter((row) => !r.made.some((m) => m.username === row.username));
                setText(left.map((row) => [row.username, row.name, row.section_id].join(", ")).join("\n"));
              }, "Couldn't make the student sign-ins.")
            }
          >
            {rows.length ? `Make ${rows.length} student sign-in${rows.length === 1 ? "" : "s"}` : "Make student sign-ins"}
          </button>
        </div>
      </div>

      {students.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <span className="mr-auto font-semibold">
              {students.length} student{students.length === 1 ? "" : "s"} can sign in
            </span>
            <label className="flex flex-col gap-1">
              <span className="field-label">Find a student</span>
              <input className="field" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Roll number, name or section" />
            </label>
          </div>
          <ul className="flex flex-col gap-2">
            {shown.slice(0, 50).map((s) => (
              <li key={s.username} className="flex flex-col gap-1 rounded-md border border-line bg-paper p-3">
                <span className="text-sm text-ink-soft">{sectionName(s.section_id)}</span>
                {line(s)}
              </li>
            ))}
          </ul>
          {shown.length > 50 && <p className="hint">Showing 50 of {shown.length}. Type in Find a student to narrow it down.</p>}
          {shown.length === 0 && <p className="text-ink-soft">No student matches “{filter}”.</p>}
        </div>
      )}
    </section>
  );
}

/** The private links from before sign-ins: still working, for anyone who already has one. */
function OldLinks({ admin }: { admin: AdminAccess }) {
  const saved = useSavedMemberLinks(admin.code);
  const [heads, setHeads] = useState<HeadOut[] | null>(null);
  const [teachers, setTeachers] = useState<TeacherLinkOut[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([listHeads(admin), listTeacherLinks(admin)])
      .then(([h, t]) => {
        setHeads(h);
        setTeachers(t);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, "Couldn't load the links.")));
  }, [admin]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e, fallback));
    } finally {
      setBusy(false);
      load();
    }
  };

  const hodLink = (h: HeadOut) =>
    run(async () => {
      if (h.has_link && !window.confirm(`Make a new HOD link for ${h.department_name}? The old link (and sign-in) stops working.`)) return;
      const out = await makeHead(admin, h.department_id, names[h.department_id] ?? h.name);
      if (out.key) saveMemberLink(admin.code, `hod:${h.department_id}`, memberLink("hod", admin.code, out.key));
    }, "Couldn't make the HOD link.");

  const teacherLink = (t: TeacherLinkOut) =>
    run(async () => {
      if (t.has_link && !window.confirm(`Make a new link for ${t.name}? Their old link (and sign-in) stops working.`)) return;
      const out = await makeTeacherLink(admin, t.teacher_id);
      if (out.key) saveMemberLink(admin.code, `teacher:${t.teacher_id}`, memberLink("teacher", admin.code, out.key));
    }, "Couldn't make the teacher link.");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-soft">
        Private links still work for anyone who has one, but sign-ins are simpler. Making a new link replaces that person’s
        sign-in, and making a sign-in replaces their link.
      </p>
      {error && <p className="font-semibold text-err">{error}</p>}
      {!heads && !error && <p className="text-ink-soft">Loading…</p>}
      {heads?.map((h) => {
        const link = saved[`hod:${h.department_id}`];
        return (
          <div key={h.department_id} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-end gap-3">
              <span className="mr-auto font-bold">{h.department_name} HOD</span>
              <label className="flex flex-col gap-1">
                <span className="field-label">HOD’s name (optional)</span>
                <input
                  className="field"
                  maxLength={120}
                  value={names[h.department_id] ?? h.name}
                  onChange={(e) => setNames({ ...names, [h.department_id]: e.target.value })}
                />
              </label>
              <button type="button" className="btn-quiet" disabled={busy} onClick={() => hodLink(h)}>
                {h.has_link ? "Make a new link" : "Make HOD link"}
              </button>
            </div>
            {link ? (
              <CopyField label={`${h.department_name} HOD link (private)`} value={link} />
            ) : (
              h.has_link && <p className="hint">This HOD has a link, made on another device.</p>
            )}
          </div>
        );
      })}
      {teachers && teachers.length > 0 && (
        <ul className="flex flex-col gap-2">
          {teachers.map((t) => {
            const link = saved[`teacher:${t.teacher_id}`];
            return (
              <li key={t.teacher_id} className="flex flex-col gap-2 rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto">
                    <span className="font-semibold">{t.name}</span> <span className="text-ink-soft">({t.teacher_id}, {t.department_id})</span>
                  </span>
                  <button type="button" className="btn-quiet !py-1" disabled={busy} onClick={() => teacherLink(t)}>
                    {t.has_link ? "Make a new link" : "Make link"}
                  </button>
                </div>
                {link ? (
                  <CopyField label={`${t.name}’s teacher link (private)`} value={link} />
                ) : (
                  t.has_link && <p className="hint">Has a link, made on another device.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
