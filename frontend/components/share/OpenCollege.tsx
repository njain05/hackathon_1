"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ApiError } from "@/lib/api";
import { getCollege, setViewedCollege } from "@/lib/cloud";

/** "K7M2QP", "k7m2qp" or a pasted share link ".../c/gndec-ludhiana" → the code or slug. */
function parseRef(text: string): string {
  const t = text.trim();
  const fromLink = t.match(/\/c\/([^/?#\s]+)/);
  return fromLink ? decodeURIComponent(fromLink[1]) : t;
}

/** Type a college code or paste the share link. */
export function CollegeCodeForm({ error, onCancel }: { error?: string; onCancel?: () => void }) {
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ref = parseRef(text);
        if (!ref) return;
        // Check the code first, so a typo never replaces the college already open on this device.
        setChecking(true);
        setWrong(null);
        try {
          const c = await getCollege(ref);
          setViewedCollege(c.code);
          onCancel?.();
        } catch (err) {
          setWrong(err instanceof ApiError ? err.message : "Couldn't check that code. Try again.");
        } finally {
          setChecking(false);
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="field-label">
          College code or share link
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. K7M2QP"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="field min-w-0 flex-1 !text-lg"
          />
          <button type="submit" className="btn-primary" disabled={!parseRef(text) || checking}>
            {checking ? "Checking…" : "Open timetable"}
          </button>
          {onCancel && (
            <button type="button" className="btn-quiet" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
      {(wrong ?? error) && (
        <p role="alert" className="font-semibold text-err">
          {wrong ?? error}
        </p>
      )}
    </form>
  );
}

/** /my with nothing to show yet: ask for the college code. */
export function OpenCollegePage({ error }: { error?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-5 px-4 py-16">
      <h1 className="text-3xl font-bold">Open your college’s timetable</h1>
      <p className="text-lg text-ink-soft">
        Type the college code your college shared with you, or open the share link they sent. You only need to do this
        once on this phone.
      </p>
      <CollegeCodeForm error={error} />
      <p className="text-ink-soft">
        Making the timetable for your college?{" "}
        <Link href="/setup" className="font-semibold text-navy underline">
          Go to setup
        </Link>
      </p>
    </main>
  );
}
