"use client";

import { localNow } from "@/lib/ask";
import { isoDate } from "@/lib/changes";
import { useAdminAccess } from "@/lib/cloud";
import type { CollegeData, SolveResult } from "@/lib/types";
import AskBox from "./AskBox";

/** The helper on /timetable, for whoever makes the timetable: needs the college saved online and published. */
export default function AdminAsk({ data, result }: { data: CollegeData; result: SolveResult }) {
  const admin = useAdminAccess();
  if (!admin) return null;
  const teacher = data.teachers[0];
  const day = data.settings.days[0];
  const examples = [
    ...(teacher && day ? [`When is ${teacher.name} free on ${day}?`] : []),
    "Which rooms are free in period 3 tomorrow?",
    "What makes up the quality score?",
  ];
  return (
    <AskBox
      code={admin.code}
      examples={examples}
      context={() => ({
        now: localNow(isoDate(new Date())),
        problems: result.problems.map((p) => p.message),
        penalties: result.stats?.penalties ?? {},
      })}
    />
  );
}
