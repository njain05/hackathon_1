"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccess } from "@/lib/access";
import { ROLE_NAME, signOut, useAccount } from "@/lib/accounts";
import { useApproverAccess } from "@/lib/bookings";
import { useAdminAccess } from "@/lib/cloud";
import { useMemberAccess } from "@/lib/members";

interface NavLink {
  href: string;
  label: string;
}

/** How many links fit in the bar on a wide screen; the rest go under "More". */
const SHOWN = 4;

export default function AppNav({ collegeName }: { collegeName?: string }) {
  const path = usePathname();
  const router = useRouter();
  const account = useAccount();
  // Teacher, HOD, Department, Changes, People and Approvals only for people holding that link on this device
  // (signing in stores the right one for the person's role).
  const admin = useAdminAccess();
  const approver = useApproverAccess();
  const teacher = useMemberAccess("teacher");
  const hod = useMemberAccess("hod");
  const incharge = useMemberAccess("incharge");
  const access = useAccess();
  const staff = Boolean(access?.staff);

  // Most useful first for whoever is signed in. Students see only the last three.
  const everyone: NavLink[] = [
    { href: "/my", label: "My timetable" },
    { href: "/book", label: "Book a room" },
    { href: "/events", label: "Events" },
  ];
  const signedIn: NavLink[] = [
    ...(admin ? [{ href: "/today", label: "Today" }] : []),
    ...(approver && !admin ? [{ href: "/approvals", label: "Approvals" }] : []),
    ...(teacher ? [{ href: "/teacher", label: "Teacher" }] : []),
    ...(hod ? [{ href: "/hod", label: "HOD" }] : []),
    ...(staff ? [{ href: "/timetable", label: "Timetables" }] : []),
    ...(admin ? [{ href: "/changes", label: "Changes" }] : []),
    ...(admin ? [{ href: "/approvals", label: "Approvals" }] : []),
    ...(staff ? [{ href: "/setup", label: "Setup" }] : []),
    ...(staff ? [{ href: "/reports", label: "Reports" }] : []),
    ...(incharge || hod ? [{ href: "/department", label: "Department" }] : []),
    ...(admin ? [{ href: "/people", label: "People" }] : []),
    ...everyone,
  ];
  // Signed out: nobody's pages, only Events, plus Setup while someone creates a brand-new college here.
  const signedOut: NavLink[] = [
    ...(staff ? [{ href: "/setup", label: "Setup" }, { href: "/timetable", label: "Timetables" }] : []),
    { href: "/events", label: "Events" },
  ];
  const links = !account ? signedOut : account.role === "student" ? everyone : signedIn;
  // Never hide just one link behind "More".
  const shown = links.length <= SHOWN + 1 ? links : links.slice(0, SHOWN);
  const more = links.slice(shown.length);

  // Each menu remembers the page it was opened on, so it closes by itself after navigating.
  const [menuAt, setMenuAt] = useState<string | null>(null); // phone menu
  const [moreAt, setMoreAt] = useState<string | null>(null); // "More" on wide screens
  const [youAt, setYouAt] = useState<string | null>(null); // account menu on wide screens
  const menuOpen = menuAt === path;
  const moreOpen = moreAt === path;
  const setMenuOpen = (open: boolean) => setMenuAt(open ? path : null);
  const setMoreOpen = (open: boolean) => setMoreAt(open ? path : null);
  const youOpen = youAt === path;
  const moreRef = useRef<HTMLLIElement>(null);
  const youRef = useRef<HTMLDivElement>(null);

  // Close menus on Escape and on a click elsewhere.
  useEffect(() => {
    if (!moreOpen && !menuOpen && !youOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreAt(null);
        setMenuAt(null);
        setYouAt(null);
      }
    };
    const click = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreAt(null);
      if (youRef.current && !youRef.current.contains(e.target as Node)) setYouAt(null);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [moreOpen, menuOpen, youOpen]);

  const name = collegeName || account?.college_name || admin?.name || "College Timetable";
  const leave = () => {
    signOut();
    router.push("/");
  };
  // "Dean", not "Dean · Dean", when the name is just the role.
  const who = account && (account.name === ROLE_NAME[account.role] ? account.name : `${account.name} · ${ROLE_NAME[account.role]}`);
  const item = (l: NavLink, block = false) => {
    const active = path === l.href;
    return (
      <Link
        href={l.href}
        aria-current={active ? "page" : undefined}
        className={`${block ? "block" : ""} rounded-md px-3 py-2 text-sm font-semibold ${active ? "bg-sky/40" : "hover:bg-blush"}`}
      >
        {l.label}
      </Link>
    );
  };
  const moreActive = more.some((l) => l.href === path);

  return (
    <header className="border-b border-line px-4 py-3 sm:px-6 print:hidden">
      <div className="flex items-center gap-x-6 gap-y-2">
        <Link href="/" className="mr-auto truncate font-bold">
          {name}
        </Link>

        {/* Wide screens: a few links, the rest under More. */}
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {shown.map((l) => (
              <li key={l.href}>{item(l)}</li>
            ))}
            {more.length > 0 && (
              <li ref={moreRef} className="relative">
                <button
                  type="button"
                  aria-expanded={moreOpen}
                  aria-controls="nav-more"
                  onClick={() => setMoreOpen(!moreOpen)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${moreActive ? "bg-sky/40" : "hover:bg-blush"}`}
                >
                  More <span aria-hidden>▾</span>
                </button>
                {moreOpen && (
                  <ul
                    id="nav-more"
                    className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col gap-0.5 rounded-md border border-line bg-paper p-1 shadow-lg"
                  >
                    {more.map((l) => (
                      <li key={l.href}>{item(l, true)}</li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </nav>

        {/* Sign in (every screen size), or the signed-in person's own menu (wide screens). */}
        {account === null && path !== "/login" && (
          <Link href="/login" className="btn-primary shrink-0">
            Sign in
          </Link>
        )}
        {account && (
          <div ref={youRef} className="relative hidden md:block">
            <button
              type="button"
              aria-expanded={youOpen}
              aria-controls="nav-you"
              onClick={() => setYouAt(youOpen ? null : path)}
              className="btn-quiet max-w-64"
            >
              <span className="truncate">{who}</span> <span aria-hidden>▾</span>
            </button>
            {youOpen && (
              <ul
                id="nav-you"
                className="absolute right-0 z-20 mt-1 flex min-w-48 flex-col gap-0.5 rounded-md border border-line bg-paper p-1 shadow-lg"
              >
                <li>{item({ href: "/account", label: "Change password" }, true)}</li>
                <li>
                  <button type="button" onClick={leave} className="menu-item w-full font-semibold">
                    Sign out
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}

        {/* Phones and narrow windows: one Menu button instead of rows of links. */}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="nav-phone"
          onClick={() => setMenuOpen(!menuOpen)}
          className="btn-quiet shrink-0 md:hidden"
        >
          <span aria-hidden>{menuOpen ? "✕" : "☰"}</span> Menu
        </button>
      </div>
      {menuOpen && (
        <nav id="nav-phone" aria-label="Main" className="pt-3 md:hidden">
          <ul className="flex flex-col gap-0.5">
            {links.map((l) => (
              <li key={l.href}>{item(l, true)}</li>
            ))}
          </ul>
          {account && (
            <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
              <p className="px-3 py-1 text-sm text-ink-soft">Signed in as {who}</p>
              {item({ href: "/account", label: "Change password" }, true)}
              <button type="button" onClick={leave} className="menu-item w-full font-semibold">
                Sign out
              </button>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
