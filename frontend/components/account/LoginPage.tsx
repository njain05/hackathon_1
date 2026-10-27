"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AppNav from "@/components/AppNav";
import { homeFor, lastSignInCollege, ROLE_NAME, signIn, signOut, useAccount } from "@/lib/accounts";
import { ApiError } from "@/lib/api";

/** "k7m 2qp" as read aloud → "K7M2QP". */
const cleanCode = (text: string) => text.replace(/\s+/g, "").toUpperCase();

/** Everyone signs in here: Dean, HODs, in-charges, teachers and students. */
export default function LoginPage() {
  const router = useRouter();
  const account = useAccount();
  const [code, setCode] = useState<string | null>(null); // null = not typed yet, show the remembered one
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (account === undefined) return <p className="p-8 text-ink-soft">Loading…</p>;
  // Only read once the browser has loaded (after the line above), so the server and browser render alike.
  const lastCode = lastSignInCollege();
  const shownCode = code ?? lastCode;

  if (account)
    return (
      <>
        <AppNav />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16">
          <h1 className="text-3xl font-bold">You’re signed in</h1>
          <p className="text-lg text-ink-soft">
            {account.name} ({ROLE_NAME[account.role]}), {account.college_name}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={homeFor(account.role)} className="btn-primary !px-5 !py-3 !text-base">
              Go to my page
            </Link>
            <button type="button" className="btn-quiet !px-5 !py-3 !text-base" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </main>
      </>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = cleanCode(shownCode);
    if (!c || !username.trim() || !password) {
      setError("Fill in the college code, your username and your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const a = await signIn(c, username.trim(), password);
      router.push(homeFor(a.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t sign in. Check your internet and try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <AppNav />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Sign in</h1>
          <p className="text-ink-soft">Use the username and password your college gave you.</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5" noValidate>
          <label className="flex flex-col gap-1">
            <span className="field-label">College code</span>
            <input
              className="field uppercase"
              value={shownCode}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="organization"
              spellCheck={false}
              maxLength={40}
              placeholder="e.g. K7M2QP"
            />
            {lastCode && code === null && <span className="hint">Remembered from your last sign-in.</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">Username</span>
            <input
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={80}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="field-label">Password</span>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={200}
            />
          </label>
          {error && (
            <p role="alert" className="font-semibold text-err">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary justify-center !py-3 !text-base" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="hint">
          Forgot your password? Ask your college’s Dean’s office to reset it. Setting up a new college?{" "}
          <Link href="/setup" className="font-semibold text-navy underline">
            Start here
          </Link>
          .
        </p>
      </main>
    </>
  );
}
