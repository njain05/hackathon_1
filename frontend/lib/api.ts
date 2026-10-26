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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new ApiError("Some entries are in the wrong format. Check the steps marked with a problem.");
  }
  if (!res.ok) throw new ApiError(`The timetable server had a problem (error ${res.status}). Try again.`);
  return (await res.json()) as T;
}

/** Fill in optional names so the server gets complete data. */
export function toApi(d: CollegeData): CollegeData {
  return {
    ...d,
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
