import type { Metadata } from "next";
import TodayPage from "@/components/today/TodayPage";

export const metadata: Metadata = {
  title: "Today | College Timetable",
};

export default function Page() {
  return <TodayPage />;
}
