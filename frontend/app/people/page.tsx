import type { Metadata } from "next";
import PeopleLinks from "@/components/people/PeopleLinks";

export const metadata: Metadata = {
  title: "People & sign-ins | College Timetable",
};

export default function Page() {
  return <PeopleLinks />;
}
