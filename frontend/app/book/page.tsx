import type { Metadata } from "next";
import BookHall from "@/components/bookings/BookHall";

export const metadata: Metadata = {
  title: "Book a room | College Timetable",
};

export default function Page() {
  return <BookHall />;
}
