"use client";

import Link from "next/link";
import { homeFor, ROLE_NAME, signOut, useAccount } from "@/lib/accounts";

/** Home's one clear start: Sign in, or (already signed in) straight to your own page. */
export default function RolePicker() {
  const account = useAccount();

  if (account === undefined) return <div className="h-32" aria-hidden />; // keep the layout still while loading

  if (account)
    return (
      <section aria-label="Your account" className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-6">
        <p className="text-lg">
          Signed in as <span className="font-bold">{account.name}</span>{" "}
          <span className="text-ink-soft">
            ({ROLE_NAME[account.role]}, {account.college_name})
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={homeFor(account.role)} className="btn-primary !px-5 !py-3 !text-base">
            Go to my page <span aria-hidden>→</span>
          </Link>
          <button type="button" className="btn-quiet !px-5 !py-3 !text-base" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </section>
    );

  return (
    <section aria-label="Start" className="flex flex-col gap-4">
      <Link href="/login" className="btn-primary w-fit !px-8 !py-4 !text-lg">
        Sign in <span aria-hidden>→</span>
      </Link>
      <p className="text-ink-soft">
        Your college gives you a username and password. New college?{" "}
        <Link href="/setup" className="font-semibold text-navy underline">
          Set it up
        </Link>
        .
      </p>
      <p className="hint">
        Organising an event?{" "}
        <Link href="/book" className="font-semibold text-navy underline">
          Book a room
        </Link>{" "}
        without an account.
      </p>
    </section>
  );
}
