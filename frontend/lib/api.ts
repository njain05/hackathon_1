import type { CollegeData, Problem, SolveResult } from "./types";

// Base URL of the FastAPI backend. Set NEXT_PUBLIC_API_URL in .env.local
// (local) or in Vercel project settings (production).
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(
      "Can't reach the timetable server. Check the internet connection, or ask whoever runs the server to start it.",
    );
  }
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
