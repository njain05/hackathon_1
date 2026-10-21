import type { Metadata } from "next";
import SetupWizard from "@/components/setup/SetupWizard";
import { CollegeProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "College setup | College Timetable",
};

export default function SetupPage() {
  return (
    <CollegeProvider>
      <SetupWizard />
    </CollegeProvider>
  );
}
