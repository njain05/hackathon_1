"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AppNav from "@/components/AppNav";
import { type AccountRole, homeFor, lastSignInCollege, ROLE_NAME, signIn, signOut, useAccount } from "@/lib/accounts";
import { ApiError } from "@/lib/api";
import { DEMO } from "@/lib/demo";

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
  // Evaluators: the chosen demo sign-in shows in grey in the boxes and is used for any box left empty.
  const [demoRole, setDemoRole] = useState<AccountRole>("dean");
  const demo = DEMO.logins.find((l) => l.role === demoRole) ?? DEMO.logins[0];
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
    // Typed values always win; an empty box falls back to the demo sign-in shown in grey.
    const c = cleanCode(shownCode) || (demo ? DEMO.code : "");
    const u = username.trim() || demo?.username || "";
    const p = password || demo?.password || "";
    if (!c || !u || !p) {
      setError("Fill in the college code, your username and your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const a = await signIn(c, u, p);
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

        {demo && (
          <div role="group" aria-labelledby="demo-label" className="flex flex-col gap-2">
            <p id="demo-label" className="field-label">
              Evaluators: try it as
            </p>
            <div className="flex flex-wrap gap-2">
              {DEMO.logins.map((l) => (
                <button
                  key={l.role}
                  type="button"
                  aria-pressed={l.role === demo.role}
                  onClick={() => {
                    setDemoRole(l.role);
                    setCode(""); // show the demo college's code instead of a remembered one
                    setError(null);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${l.role === demo.role ? "border-navy bg-sky/40" : "border-line bg-paper hover:bg-blush"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
              placeholder={demo ? DEMO.code : "e.g. K7M2QP"}
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
              placeholder={demo?.username}
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
              placeholder={demo?.password}
            />
          </label>
          {demo && (
            <p className="hint">
              <span aria-hidden>🎓 </span>Evaluators: the demo sign-in is shown in grey. Just press Sign in.
            </p>
          )}
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
