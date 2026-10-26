import type { Metadata } from "next";
import BookHall from "@/components/bookings/BookHall";

export const metadata: Metadata = {
  title: "Book a hall | College Timetable",
};

export default function Page() {
  return <BookHall />;
}
