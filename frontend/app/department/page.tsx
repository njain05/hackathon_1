import type { Metadata } from "next";
import DepartmentPage from "@/components/department/DepartmentPage";

export const metadata: Metadata = {
  title: "Department setup | College Timetable",
};

export default function Page() {
  return <DepartmentPage />;
}
