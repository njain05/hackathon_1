"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { ApiError } from "@/lib/api";
import { getApprovals } from "@/lib/bookings";
import { type CoverView, getCover, isoDate } from "@/lib/changes";
import { type AdminCollege, getAdminCollege, useAdminAccess } from "@/lib/cloud";
import PageLoading from "@/components/ui/PageLoading";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

interface Task {
  /** Needs the Dean now (shown first, in red) or just for information. */
  urgent: boolean;
  title: string;
  text: string;
  href: string;
  action: string;
}

interface Loaded {
  college: AdminCollege;
  /** `null` when today's changes can't be read, e.g. nothing is published yet. */
  cover: CoverView | null;
  pendingBookings: number;
  /** When this was loaded: "today" is the visitor's day, never the build's. */
  at: Date;
}

/** The Dean's home: what needs doing today, each with one button that goes there. */
export default function TodayPage() {
  const admin = useAdminAccess();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!admin) return;
    const at = new Date();
    Promise.all([
      getAdminCollege(admin),
      getCover(admin, isoDate(at)).catch(() => null),
      getApprovals({ admin }).then((v) => v.bookings.filter((b) => b.status === "pending").length),
    ])
      .then(([college, cover, pendingBookings]) => {
        setData({ college, cover, pendingBookings, at });
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, "Couldn't load today's work.")));
  }, [admin]);

  useEffect(() => {
    load();
    // Come back to the tab → show the latest.
    const again = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);

  if (admin === undefined) return <PageLoading />;
  if (!admin)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Today</h1>
          <p className="text-lg text-ink-soft">
            This page is for the Dean. Open the Dean’s link on this device, or set up your college first.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/setup" className="btn-primary w-fit">
              Set up your college
            </Link>
            <Link href="/my" className="btn-quiet w-fit">
              My timetable
            </Link>
          </div>
        </main>
      </>
    );

  const tasks = data ? todo(data) : [];
  const urgent = tasks.filter((t) => t.urgent);
  const dateText = data?.at.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <AppNav collegeName={data?.college.name ?? admin.name} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold sm:text-3xl">Today{dateText && `, ${dateText}`}</h1>
            <p aria-live="polite" className="text-ink-soft">
              {!data
                ? "Checking what needs doing…"
                : urgent.length === 0
                  ? "Nothing needs you right now."
                  : `${urgent.length} thing${urgent.length === 1 ? " needs" : "s need"} you.`}
            </p>
          </div>
          <button type="button" onClick={load} className="btn-quiet">
            Refresh
          </button>
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-err/40 bg-paper p-4">
            <p className="font-semibold text-err">{error}</p>
            <button type="button" onClick={load} className="btn-quiet">
              Try again
            </button>
          </div>
        )}

        {data && (
          <ul className="flex flex-col gap-3">
            {[...urgent, ...tasks.filter((t) => !t.urgent)].map((t) => (
              <li
                key={t.title}
                className={`flex flex-wrap items-center gap-4 rounded-lg border bg-paper p-4 ${t.urgent ? "border-err/40 border-l-4 border-l-err" : "border-line"}`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="font-bold">{t.title}</p>
                  <p className="hint">{t.text}</p>
                </div>
                <Link href={t.href} className={t.urgent ? "btn-primary" : "btn-quiet"}>
                  {t.action}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section aria-labelledby="more-admin" className="flex flex-col gap-2">
          <h2 id="more-admin" className="text-lg font-bold">
            Everything else
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/setup" className="btn-quiet">
              Edit the setup
            </Link>
            <Link href="/timetable" className="btn-quiet">
              All timetables
            </Link>
            <Link href="/people" className="btn-quiet">
              Teacher and HOD links
            </Link>
            <Link href="/events" className="btn-quiet">
              Events
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

/** Turn what the server says into a short to-do list. */
function todo({ college, cover, pendingBookings }: Loaded): Task[] {
  const tasks: Task[] = [];

  if (!college.published_version) {
    tasks.push({
      urgent: true,
      title: "Timetable not published yet",
      text: "Students and teachers can't see anything until you publish.",
      href: "/timetable",
      action: "Generate & publish",
    });
  } else {
    const changed =
      college.data_updated_at && college.published_at && new Date(college.data_updated_at) > new Date(college.published_at);
    tasks.push({
      urgent: Boolean(changed),
      title: changed ? "Setup changed after publishing" : `Timetable published (version ${college.published_version})`,
      text: changed
        ? "Students still see the old timetable. Generate again and publish if the change matters."
        : `Live since ${new Date(college.published_at ?? "").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`,
      href: changed ? "/setup" : "/timetable",
      action: changed ? "Check & generate" : "View",
    });
  }

  if (cover) {
    const classes = cover.leaves.flatMap((l) => l.classes);
    const needCover = classes.filter((c) => c.state === "needs_cover").length;
    const waitingLeave = cover.leaves.filter((l) => l.status === "pending").length;
    if (!cover.working_day) {
      tasks.push({ urgent: false, title: "No classes today", text: `${cover.day} is not a working day.`, href: "/changes", action: "Plan another day" });
    } else {
      if (waitingLeave > 0)
        tasks.push({
          urgent: true,
          title: `${waitingLeave} leave request${waitingLeave === 1 ? "" : "s"} waiting`,
          text: "Waiting for the HOD or you. Cover is arranged once leave is approved.",
          href: "/changes",
          action: "Review leave",
        });
      tasks.push(
        needCover > 0
          ? {
              urgent: true,
              title: `${needCover} class${needCover === 1 ? " needs" : "es need"} cover`,
              text: "A teacher is on leave. Assign a substitute or cancel the class.",
              href: "/changes",
              action: "Arrange cover",
            }
          : {
              urgent: false,
              title: cover.leaves.length ? "All classes covered" : "No teachers on leave",
              text: `${cover.changes.length} change${cover.changes.length === 1 ? "" : "s"} to today's timetable.`,
              href: "/changes",
              action: "Daily changes",
            },
      );
    }
  }

  tasks.push(
    pendingBookings > 0
      ? {
          urgent: true,
          title: `${pendingBookings} hall booking${pendingBookings === 1 ? "" : "s"} waiting`,
          text: "Organisers are waiting for an answer.",
          href: "/approvals",
          action: "Review bookings",
        }
      : { urgent: false, title: "No hall bookings waiting", text: "New requests show up here.", href: "/approvals", action: "Approvals" },
  );

  return tasks;
}
