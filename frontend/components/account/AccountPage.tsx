"use client";

import Link from "next/link";
import { useState } from "react";
import AppNav from "@/components/AppNav";
import { changePassword, ROLE_NAME, useAccount } from "@/lib/accounts";
import { ApiError } from "@/lib/api";

const MIN_LENGTH = 6; // the same as the server (backend/app/accounts.py)

/** Change your own password: old, new, and the new one again. */
export default function AccountPage() {
  const account = useAccount();
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (account === undefined) return <p className="p-8 text-ink-soft">Loading…</p>;
  if (!account)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">Your account</h1>
          <p className="text-lg text-ink-soft">Sign in first to change your password.</p>
          <Link href="/login" className="btn-primary w-fit">
            Sign in
          </Link>
        </main>
      </>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(false);
    if (!old || !next || !again) return setError("Fill in all three boxes.");
    if (next.length < MIN_LENGTH) return setError(`The new password needs at least ${MIN_LENGTH} characters.`);
    if (next !== again) return setError("The two new passwords don’t match. Type them again.");
    if (next === old) return setError("The new password is the same as the old one.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(old, next);
      setOld("");
      setNext("");
      setAgain("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t change the password. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold">Change password</h1>
          <p className="text-ink-soft">
            {account.name} ({ROLE_NAME[account.role]}), username <span className="font-semibold text-ink">{account.username}</span>
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5" noValidate>
          {/* Lets password managers save the new password against the right username. */}
          <input type="hidden" name="username" autoComplete="username" value={account.username} readOnly />
          <label className="flex flex-col gap-1">
            <span className="field-label">Current password</span>
            <input className="field" type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" maxLength={200} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">New password</span>
            <input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={200} />
            <span className="hint">At least {MIN_LENGTH} characters.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">New password again</span>
            <input className="field" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" maxLength={200} />
          </label>
          {error && (
            <p role="alert" className="font-semibold text-err">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="font-semibold text-ok">
              Password changed. Use the new one next time you sign in.
            </p>
          )}
          <button type="submit" className="btn-primary justify-center !py-3 !text-base" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </form>
      </main>
    </>
  );
}
