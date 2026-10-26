"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { type AskRequest, type AskTurn, askTimetable } from "@/lib/ask";

interface Props {
  /** The published college to ask about. */
  code: string;
  /** Three starter questions, shown as buttons. */
  examples: string[];
  /** Built fresh for each question (who is asking, their clock, admin extras). */
  context: () => Omit<AskRequest, "question" | "history">;
}

/** "Ask the timetable": plain-English questions, answered only from the real timetable by a Claude helper. */
export default function AskBox({ code, examples, context }: Props) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const send = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await askTimetable(code, { question: text, history: turns, ...context() });
      setTurns((t) => [...t, { question: text, answer: r.answer }]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The helper didn't answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Ask the timetable" className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4 print:hidden">
      <div>
        <h2 className="text-xl font-bold">Ask the timetable</h2>
        <p className="text-sm text-ink-soft">
          Ask in plain English. Answers come only from the published timetable and today’s changes.
        </p>
      </div>

      {turns.length > 0 && (
        <ol className="flex flex-col gap-3" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className="flex flex-col gap-1">
              <p className="self-end rounded-md bg-sky/30 px-3 py-2 font-semibold">{t.question}</p>
              <p className="rounded-md bg-cream px-3 py-2 whitespace-pre-line">{t.answer}</p>
            </li>
          ))}
        </ol>
      )}
      {busy && <p className="text-ink-soft">Checking the timetable…</p>}
      {error && (
        <p role="alert" className="font-semibold text-err">
          {error}
        </p>
      )}
      <div ref={endRef} />

      <div className="flex flex-wrap gap-2" aria-label="Example questions">
        {examples.map((q) => (
          <button key={q} type="button" className="btn-quiet !py-1.5" disabled={busy} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
      >
        <label htmlFor={inputId} className="field-label">
          Your question
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            className="field min-w-0 flex-1"
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. When is Prof. Sharma free on Friday?"
            autoComplete="off"
          />
          <button type="submit" className="btn-primary" disabled={busy || !question.trim()}>
            {busy ? "Asking…" : "Ask"}
          </button>
          {turns.length > 0 && (
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => { setTurns([]); setError(null); }}>
              Clear
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
