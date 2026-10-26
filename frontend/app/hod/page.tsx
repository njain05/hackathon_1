import type { Metadata } from "next";
import HodPage from "@/components/changes/HodPage";

export const metadata: Metadata = {
  title: "HOD page | College Timetable",
};

export default function Page() {
  return <HodPage />;
}
