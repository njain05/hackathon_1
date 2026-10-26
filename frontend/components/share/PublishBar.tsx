"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { getCollege, publishTimetable, setLiveMark, shareLink, useAdminAccess, useLiveMark } from "@/lib/cloud";
import type { StoredTimetable } from "@/lib/result";
import { CopyField } from "./CloudSave";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** On /timetable: make the generated timetable live for students and teachers. */
export default function PublishBar({ stored }: { stored: StoredTimetable }) {
  const access = useAdminAccess();
  const mark = useLiveMark();
  const [online, setOnline] = useState<{ code: string; version: number | null; at: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which version is live right now (it may have been published from another device).
  const code = access?.code;
  useEffect(() => {
    if (!code) return;
    let live = true;
    getCollege(code)
      .then((c) => live && setOnline({ code, version: c.published_version, at: c.published_at }))
      .catch(() => undefined); // only extra detail; publishing still works
    return () => {
      live = false;
    };
  }, [code]);

  if (access === undefined || mark === undefined) return null;

  if (!access)
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-paper p-4 print:hidden">
        <p className="mr-auto">
          <span className="font-semibold">Only this browser can see this timetable.</span>{" "}
          <span className="text-ink-soft">
            To share it, press “Save online &amp; share” in the setup, then come back here and publish.
          </span>
        </p>
        <Link href="/setup" className="btn-quiet">
          Go to setup
        </Link>
      </section>
    );

  const isLive = mark?.code === access.code && mark.at === stored.at;
  const liveNow = online?.code === access.code && online.version ? online : null;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await publishTimetable(access, stored);
      setLiveMark({ code: access.code, at: stored.at, version: r.version, published_at: r.published_at });
      setOnline({ code: access.code, version: r.version, at: r.published_at });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't publish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (isLive && (!liveNow || liveNow.version === mark.version))
    return (
      <section aria-live="polite" className="flex flex-col gap-3 rounded-md border border-ok/40 bg-mint/60 p-4 print:hidden">
        <p>
          <span className="font-semibold text-ok">Live for everyone.</span> Version {mark.version}, published{" "}
          {when(mark.published_at)}. Students and teachers open the share link, or type the college code on My timetable.
        </p>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <CopyField label="Share link" value={shareLink(access)} />
          <CopyField label="College code" value={access.code} big />
        </div>
      </section>
    );

  return (
    <section aria-live="polite" className="flex flex-col gap-2 rounded-md border border-line bg-blush p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto">
          <span className="font-semibold">This timetable isn’t live yet.</span>{" "}
          <span className="text-ink-soft">
            {liveNow
              ? `Version ${liveNow.version} (published ${when(liveNow.at!)}) is what students and teachers see now. Publishing replaces it.`
              : "Publish it so students and teachers can open it on their own phones."}
          </span>
        </p>
        <button type="button" className="btn-primary !px-5 !py-3 !text-base" disabled={busy} onClick={publish}>
          {busy ? "Publishing…" : "Publish timetable"}
        </button>
      </div>
      {error && <p className="font-semibold text-err">{error}</p>}
    </section>
  );
}
