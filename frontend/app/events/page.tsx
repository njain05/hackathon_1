import type { Metadata } from "next";
import EventsCalendar from "@/components/bookings/EventsCalendar";

export const metadata: Metadata = {
  title: "Events | College Timetable",
};

export default function Page() {
  return <EventsCalendar />;
}
