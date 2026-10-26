"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/lib/access";
import { useApproverAccess } from "@/lib/bookings";
import { useAdminAccess } from "@/lib/cloud";
import { useMemberAccess } from "@/lib/members";

// Everyone: students, teachers and organisers.
const PUBLIC_LINKS = [
  { href: "/my", label: "My timetable" },
  { href: "/book", label: "Book a hall" },
  { href: "/events", label: "Events" },
];
// Only for whoever makes the timetable on this device.
const STAFF_LINKS = [
  { href: "/setup", label: "Setup" },
  { href: "/timetable", label: "Timetables" },
];

export default function AppNav({ collegeName }: { collegeName?: string }) {
  const path = usePathname();
  // Teacher, HOD, Changes and People (admin) and Approvals only for people holding that link on this device.
  const admin = useAdminAccess();
  const approver = useApproverAccess();
  const teacher = useMemberAccess("teacher");
  const hod = useMemberAccess("hod");
  const incharge = useMemberAccess("incharge");
  const access = useAccess();
  const links = [
    ...(access?.staff ? STAFF_LINKS : []),
    ...PUBLIC_LINKS,
    ...(teacher ? [{ href: "/teacher", label: "Teacher" }] : []),
    ...(hod ? [{ href: "/hod", label: "HOD" }] : []),
    ...(incharge || hod ? [{ href: "/department", label: "Department" }] : []),
    ...(admin ? [{ href: "/changes", label: "Changes" }, { href: "/people", label: "People" }] : []),
    ...(admin || approver ? [{ href: "/approvals", label: "Approvals" }] : []),
  ];
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-3 sm:px-6 print:hidden">
      <Link href="/" className="mr-auto truncate font-bold">
        {collegeName || "College Timetable"}
      </Link>
      <nav aria-label="Main">
        <ul className="flex flex-wrap gap-1">
          {links.map((l) => {
            const active = path === l.href;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${active ? "bg-sky/40" : "hover:bg-blush"}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
