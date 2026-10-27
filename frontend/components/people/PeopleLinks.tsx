"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { CopyField } from "@/components/share/CloudSave";
import { ApiError } from "@/lib/api";
import { useAdminAccess } from "@/lib/cloud";
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
import PageLoading from "@/components/ui/PageLoading";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Admin: each HOD's and each teacher's private link. Students never need one. */
export default function PeopleLinks() {
  const admin = useAdminAccess();
  const saved = useSavedMemberLinks(admin?.code);
  const [heads, setHeads] = useState<HeadOut[] | null>(null);
  const [teachers, setTeachers] = useState<TeacherLinkOut[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!admin) return;
    Promise.all([listHeads(admin), listTeacherLinks(admin)])
      .then(([h, t]) => {
        setHeads(h);
        setTeachers(t);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, "Couldn't load the people.")));
  }, [admin]);

  useEffect(() => {
    load();
  }, [load]);

  if (admin === undefined) return <PageLoading />;
  if (!admin)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">People &amp; links</h1>
          <p className="text-lg text-ink-soft">Only the timetable admin can make links. Open your admin link first.</p>
          <Link href="/my" className="btn-quiet w-fit">
            My timetable
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

  const hodLink = (h: HeadOut) =>
    run(async () => {
      if (h.has_link && !window.confirm(`Make a new HOD link for ${h.department_name}? The old link stops working.`)) return;
      const out = await makeHead(admin, h.department_id, names[h.department_id] ?? h.name);
      if (out.key) saveMemberLink(admin.code, `hod:${h.department_id}`, memberLink("hod", admin.code, out.key));
    }, "Couldn't make the HOD link.");

  const teacherLink = (t: TeacherLinkOut, ask = true) =>
    run(async () => {
      if (ask && t.has_link && !window.confirm(`Make a new link for ${t.name}? Their old link stops working.`)) return;
      const out = await makeTeacherLink(admin, t.teacher_id);
      if (out.key) saveMemberLink(admin.code, `teacher:${t.teacher_id}`, memberLink("teacher", admin.code, out.key));
    }, "Couldn't make the teacher link.");

  const missing = teachers?.filter((t) => !t.has_link) ?? [];

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold sm:text-3xl">People &amp; links</h1>
          <p className="text-ink-soft">
            Send each person their own private link (WhatsApp or email). HODs approve their teachers’ leave; teachers ask
            for leave from their own page. Students and organisers never need a link. Links are saved in this browser; on
            another device, make a new one (the old one stops working).
          </p>
        </div>
        {error && (
          <p role="alert" className="font-semibold text-err">
            {error}
          </p>
        )}
        {!heads && !error && <p className="text-ink-soft">Loading…</p>}

        {heads && (
          <section aria-label="Heads of department" className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">Heads of department</h2>
            {heads.length === 0 && <p className="text-ink-soft">No departments in the published timetable.</p>}
            {heads.map((h) => {
              const link = saved[`hod:${h.department_id}`];
              return (
                <div key={h.department_id} className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <span className="mr-auto text-lg font-bold">{h.department_name}</span>
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
                  ) : h.has_link ? (
                    <p className="hint">This HOD has a link, made on another device.</p>
                  ) : (
                    <p className="hint">No HOD link yet: the admin approves this department’s leave.</p>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {teachers && (
          <section aria-label="Teachers" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-xl font-bold">Teachers</h2>
              {missing.length > 0 && (
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={busy}
                  onClick={() => run(async () => {
                    for (const t of missing) {
                      const out = await makeTeacherLink(admin, t.teacher_id);
                      if (out.key) saveMemberLink(admin.code, `teacher:${t.teacher_id}`, memberLink("teacher", admin.code, out.key));
                    }
                  }, "Couldn't make all the links.")}
                >
                  Make links for all {missing.length} teachers without one
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {teachers.map((t) => {
                const link = saved[`teacher:${t.teacher_id}`];
                return (
                  <li key={t.teacher_id} className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3">
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
          </section>
        )}
      </main>
    </>
  );
}
