import type { AccountRole } from "./accounts";

// A demo college on the live site, so evaluators can sign in as every role from
// the Sign in page (the details show in grey in the boxes). These sign-ins are
// meant to be public: they open only the demo college, never a real one.
// NEXT_PUBLIC_DEMO_LOGINS (JSON, same shape) overrides them, e.g. for a local copy.

export interface DemoLogin {
  role: AccountRole;
  label: string;
  username: string;
  password: string;
}

const LIVE: { code: string; logins: DemoLogin[] } = {
  code: "4H7GM5",
  logins: [
    { role: "dean", label: "Dean", username: "dean", password: "demo1234" },
    { role: "hod", label: "HOD", username: "hod", password: "demo1234" },
    { role: "incharge", label: "Timetable in-charge", username: "incharge", password: "demo1234" },
    { role: "teacher", label: "Teacher", username: "teacher", password: "demo1234" },
    { role: "student", label: "Student", username: "student", password: "demo1234" },
  ],
};

function fromEnv(): { code: string; logins: DemoLogin[] } | null {
  const raw = process.env.NEXT_PUBLIC_DEMO_LOGINS;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { code: string; logins: DemoLogin[] };
  } catch {
    return null;
  }
}

const chosen = fromEnv() ?? LIVE;

/** The demo college and its sign-ins; `logins` is empty when there is no demo college. */
export const DEMO: { code: string; logins: DemoLogin[] } = chosen.code ? chosen : { code: "", logins: [] };
