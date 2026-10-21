import type { Metadata } from "next";
import MyTimetable from "@/components/timetable/MyTimetable";

export const metadata: Metadata = {
  title: "My timetable | College Timetable",
};

export default function Page() {
  return <MyTimetable />;
}
