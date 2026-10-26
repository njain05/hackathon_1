import type { Metadata } from "next";
import { Suspense } from "react";
import TrackBooking from "@/components/bookings/TrackBooking";

export const metadata: Metadata = {
  title: "Booking request | College Timetable",
};

/** The organiser's tracking link: /track/<token>. */
export default function Page({ params }: PageProps<"/track/[token]">) {
  return (
    <Suspense fallback={<p className="p-8 text-ink-soft">Loading your request…</p>}>
      <Track params={params} />
    </Suspense>
  );
}

async function Track({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackBooking token={token} />;
}
