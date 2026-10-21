import type { Metadata } from "next";
import TimetablePage from "@/components/timetable/TimetablePage";

export const metadata: Metadata = {
  title: "Timetables | College Timetable",
};

export default function Page() {
  return <TimetablePage />;
}
