"use client";

import { useEffect, useState } from "react";
import { CopyField } from "@/components/share/CloudSave";
import { ApiError } from "@/lib/api";
import { createAccount, makeInchargeAccount, type MadeAccount } from "@/lib/accounts";
import { getIncharge, staffCode, staffId, type InchargeOut, type Staff } from "@/lib/departments";

/** HOD (or Dean): choose the teacher who makes this department's timetable, and give them their sign-in. */
export default function InchargeLink({
  staff,
  dept,
  teachers,
}: {
  staff: Staff;
  dept: string;
  /** This department's teachers, to pick from. */
  teachers: { id: string; name: string }[];
}) {
  const [current, setCurrent] = useState<InchargeOut | null>(null);
  const [teacher, setTeacher] = useState("");
  const [username, setUsername] = useState("");
  const [made, setMade] = useState<MadeAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const who = staffId(staff);
  useEffect(() => {
    getIncharge(staff, dept)
      .then(setCurrent)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Couldn't load the in-charge."));
    // Reload only when the person or department changes, not when the caller rebuilds `staff`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, dept]);

  const appoint = async () => {
    const t = teachers.find((x) => x.id === teacher);
    if (!t) return;
    if (current?.name && !window.confirm(`Make ${t.name} the timetable in-charge? ${current.name}'s sign-in will stop working.`)) return;
    setBusy(true);
    setError(null);
    try {
      const user = username.trim() || `${t.id.toLowerCase()}.incharge`;
      const r =
        "admin" in staff
          ? await createAccount(staff.admin, { role: "incharge", username: user, name: t.name, department_id: dept })
          : await makeInchargeAccount(staff.member.college_code, staff.member.key, dept, user, t.name);
      setMade(r);
      setCurrent({ department_id: dept, name: t.name, since: new Date().toISOString(), key: null });
      setUsername("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't make the sign-in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4" aria-labelledby="incharge">
      <h2 id="incharge" className="text-lg font-bold">
        Timetable in-charge for {dept}
      </h2>
      <p className="hint max-w-2xl">
        The in-charge enters {dept}&apos;s rooms, teachers, sections and subjects, and sends them to you for approval. They can&apos;t change
        other departments.
      </p>
      <p>{current?.name ? <>Now: <span className="font-semibold">{current.name}</span></> : "No in-charge yet."}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="field-label">{current?.name ? "Change to" : "Choose a teacher"}</span>
          <select className="field min-w-64" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">Choose…</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Username (optional)</span>
          <input
            className="field w-48"
            value={username}
            placeholder={teacher ? `${teacher.toLowerCase()}.incharge` : "e.g. hk.incharge"}
            autoCapitalize="none"
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <button type="button" className="btn-primary" disabled={!teacher || busy} onClick={appoint}>
          {busy ? "Making sign-in…" : "Make in-charge sign-in"}
        </button>
      </div>
      {error && <p className="font-semibold text-err">{error}</p>}
      {made && (
        <div className="flex flex-col gap-2 rounded-md bg-blush/60 p-3">
          <p className="font-semibold">Give these to {made.name} privately. They sign in at the Sign in page.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <CopyField label="College code" value={staffCode(staff)} />
            <CopyField label="Username" value={made.username} />
            <CopyField label="Password" value={made.password} />
          </div>
          <p className="hint">The password is shown only once. They can change it after signing in.</p>
        </div>
      )}
    </section>
  );
}
