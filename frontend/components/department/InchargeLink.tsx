"use client";

import { useEffect, useState } from "react";
import { CopyField } from "@/components/share/CloudSave";
import { ApiError } from "@/lib/api";
import { getIncharge, inchargeLink, makeIncharge, staffCode, staffId, type InchargeOut, type Staff } from "@/lib/departments";

/** HOD (or admin): choose the teacher who makes this department's timetable, and give them their link. */
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
  const [link, setLink] = useState<string | null>(null);
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
    if (current?.name && !window.confirm(`Make ${t.name} the timetable in-charge? ${current.name}'s link will stop working.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await makeIncharge(staff, dept, t.name, t.id);
      setCurrent(r);
      if (r.key) setLink(inchargeLink(staffCode(staff), r.key));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't make the link. Try again.");
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
        The in-charge enters {dept}&apos;s rooms, teachers, sections and subjects, and marks the department ready. They can&apos;t change
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
        <button type="button" className="btn-primary" disabled={!teacher || busy} onClick={appoint}>
          {busy ? "Making link…" : "Make in-charge link"}
        </button>
      </div>
      {error && <p className="font-semibold text-err">{error}</p>}
      {link && (
        <div className="flex flex-col gap-2 rounded-md bg-blush/60 p-3">
          <p className="font-semibold">Send this link to {current?.name} privately. It works like their password for {dept}&apos;s setup.</p>
          <CopyField label="In-charge link" value={link} />
          <p className="hint">It is shown only once. Making a new link later stops this one.</p>
        </div>
      )}
    </section>
  );
}
