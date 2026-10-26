// "Ask the timetable" (backend/app/ask.py). The Claude API key stays on the server.

import { call } from "./api";

export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskRequest {
  question: string;
  /** Earlier turns, oldest first (the server keeps the last 4). */
  history: AskTurn[];
  /** Who is asking, as chosen on My timetable, so "my next class" works. */
  me?: { role: "section" | "teacher"; id: string } | null;
  /** The asker's local date and time, YYYY-MM-DDTHH:MM. */
  now: string;
  /** For the admin: the last generate's problems and quality breakdown. */
  problems?: string[];
  penalties?: Record<string, number>;
}

export const askTimetable = (code: string, body: AskRequest) =>
  call<{ answer: string; tools_used: string[] }>(`/colleges/${encodeURIComponent(code)}/ask`, {
    method: "POST",
    body: JSON.stringify({ ...body, history: body.history.slice(-4) }),
  });

/** Local date and time as YYYY-MM-DDTHH:MM (`minutes` overrides the time, e.g. the ?now= demo clock). */
export function localNow(date: string, minutes?: number): string {
  const d = new Date();
  const m = minutes ?? d.getHours() * 60 + d.getMinutes();
  return `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
