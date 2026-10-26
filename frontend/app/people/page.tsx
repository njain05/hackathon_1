import type { Metadata } from "next";
import PeopleLinks from "@/components/people/PeopleLinks";

export const metadata: Metadata = {
  title: "People & links | College Timetable",
};

export default function Page() {
  return <PeopleLinks />;
}
