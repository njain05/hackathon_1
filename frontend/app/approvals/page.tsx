import type { Metadata } from "next";
import Approvals from "@/components/bookings/Approvals";

export const metadata: Metadata = {
  title: "Booking approvals | College Timetable",
};

export default function Page() {
  return <Approvals />;
}
