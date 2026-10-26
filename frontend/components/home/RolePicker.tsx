"use client";

import Link from "next/link";
import { useAccess } from "@/lib/access";
import { useAdminAccess } from "@/lib/cloud";
import { useMemberAccess } from "@/lib/members";

interface Role {
  href: string;
  title: string;
  text: string;
}

/** "Who are you?": one big card per kind of person, so nobody has to read the whole menu. */
export default function RolePicker() {
  const admin = useAdminAccess();
  const teacher = useMemberAccess("teacher");
  const access = useAccess();

  const roles: Role[] = [
    { href: "/my", title: "Student", text: "Your class timetable for today and the week." },
    {
      href: teacher ? "/teacher" : "/my",
      title: "Teacher",
      text: teacher ? "Your classes, changes and leave." : "Your classes for today and the week.",
    },
    { href: "/book", title: "Event organiser", text: "Book a seminar hall or auditorium and track the approval." },
    {
      href: admin ? "/today" : "/setup",
      title: "Timetable admin",
      text: admin
        ? "What needs doing today: cover, approvals, publishing."
        : access?.staff
          ? "Carry on setting up your college."
          : "Set up your college and generate a clash-free timetable.",
    },
  ];

  return (
    <section aria-labelledby="who" className="flex flex-col gap-3">
      <h2 id="who" className="text-xl font-bold">
        Who are you?
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {roles.map((r) => (
          <li key={r.title}>
            <Link
              href={r.href}
              className="flex h-full flex-col gap-1 rounded-lg border border-line bg-paper p-5 hover:border-navy hover:bg-blush/40 focus-visible:border-navy"
            >
              <span className="text-lg font-bold text-navy">
                {r.title} <span aria-hidden>→</span>
              </span>
              <span className="text-ink-soft">{r.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
