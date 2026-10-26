"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApproverAccess } from "@/lib/bookings";
import { useAdminAccess } from "@/lib/cloud";

const LINKS = [
  { href: "/setup", label: "Setup" },
  { href: "/timetable", label: "Timetables" },
  { href: "/my", label: "My timetable" },
  { href: "/book", label: "Book a hall" },
  { href: "/events", label: "Events" },
];

export default function AppNav({ collegeName }: { collegeName?: string }) {
  const path = usePathname();
  // Approvals only for people holding an admin or approver link on this device.
  const admin = useAdminAccess();
  const approver = useApproverAccess();
  const links = admin || approver ? [...LINKS, { href: "/approvals", label: "Approvals" }] : LINKS;
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
