import type { Metadata } from "next";
import DailyChanges from "@/components/changes/DailyChanges";

export const metadata: Metadata = {
  title: "Daily changes | College Timetable",
};

export default function Page() {
  return <DailyChanges />;
}
