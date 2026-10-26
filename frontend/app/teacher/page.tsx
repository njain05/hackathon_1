import type { Metadata } from "next";
import TeacherPage from "@/components/changes/TeacherPage";

export const metadata: Metadata = {
  title: "Teacher page | College Timetable",
};

export default function Page() {
  return <TeacherPage />;
}
