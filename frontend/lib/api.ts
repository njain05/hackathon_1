import { API_URL, ensureAwake, markAwake } from "./server";
import type { CollegeData, Problem, SolveResult } from "./types";

// Base URL of the FastAPI backend: NEXT_PUBLIC_API_URL in .env.local (local)
// or in the Vercel project settings (production). See lib/server.ts.
export { API_URL };

export class ApiError extends Error {}

const UNREACHABLE =
  "Can't reach the timetable server. Check the internet connection and try again in a minute.";

/** Statuses a sleeping or restarting server (or its proxy) answers with. */
const NOT_READY = new Set([502, 503, 504]);

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!(await ensureAwake())) throw new ApiError(UNREACHABLE);

  const send = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });

  let res: Response | null = null;
  try {
    res = await send();
  } catch {
    res = null;
  }
  // The server went to sleep or restarted mid-way: wake it and try once more.
  if (!res || NOT_READY.has(res.status)) {
    if (!(await ensureAwake(true))) throw new ApiError(UNREACHABLE);
    try {
      res = await send();
    } catch {
      throw new ApiError(UNREACHABLE);
    }
  }
  markAwake();
  if (res.status === 422) {
    throw new ApiError(await formatProblem(res), { cause: 422 });
  }
  if (!res.ok) {
    // The server's own plain-English reason (e.g. "No college with the code …"), when it gives one.
    const detail = await res
      .json()
      .then((b: { detail?: unknown }) => b.detail)
      .catch(() => null);
    throw new ApiError(
      typeof detail === "string" ? detail : "The timetable server had a problem. Try again in a moment.",
      { cause: res.status },
    );
  }
  if (res.status === 204) return null as T; // done, nothing to read (e.g. a delete)
  return (await res.json()) as T;
}

/** "Some details aren't right" → name the field and say why, e.g. "Title: should have at most 200 characters". */
async function formatProblem(res: Response): Promise<string> {
  const fallback = "Some of the details aren't in the right format. Check them and try again.";
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (typeof body?.detail === "string") return body.detail;
  if (!Array.isArray(body?.detail)) return fallback;
  const lines = (body.detail as { loc?: unknown[]; msg?: string }[]).slice(0, 3).map((e) => {
    const field = [...(e.loc ?? [])].reverse().find((x) => typeof x === "string" && x !== "body");
    const label = typeof field === "string" ? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";
    const msg = (e.msg ?? "is not valid").replace(/^(String|Value|Input) /, "");
    return label ? `${label}: ${msg}` : msg;
  });
  return lines.length ? lines.join(". ") + "." : fallback;
}

/** Fill in optional names so the server gets complete data. */
export function toApi(d: CollegeData): CollegeData {
  const n = d.settings.periods_per_day;
  return {
    ...d,
    // Breaks after the last period and extra per-period lengths are kept while
    // the admin edits the number of periods; the server only gets what fits.
    settings: {
      ...d.settings,
      breaks: d.settings.breaks.filter((b) => b.after_period < n),
      period_lengths: d.settings.period_lengths
        ? Array.from({ length: n }, (_, i) => d.settings.period_lengths?.[i] ?? d.settings.period_minutes)
        : null,
    },
    name: d.name.trim() || "My College",
    rooms: d.rooms.map((r) => ({ ...r, name: r.name.trim() || r.id })),
    sections: d.sections.map((s) => ({ ...s, name: s.name.trim() || s.id })),
    subjects: d.subjects.map((s) => ({ ...s, code: s.id })),
  };
}

export const getSample = () => call<CollegeData>("/sample");

export const checkCollege = (d: CollegeData) =>
  call<{ ok: boolean; problems: Problem[] }>("/check", { method: "POST", body: JSON.stringify(toApi(d)) });

export const generateTimetable = (d: CollegeData) =>
  call<SolveResult>("/generate?time_limit=20", { method: "POST", body: JSON.stringify(toApi(d)) });
