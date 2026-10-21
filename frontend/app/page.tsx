import HealthStatus from "@/components/HealthStatus";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">College Timetable</h1>
      <p className="max-w-md text-zinc-600">
        One place for the whole college: timetables, schedules and hall bookings.
      </p>
      <HealthStatus />
    </main>
  );
}
