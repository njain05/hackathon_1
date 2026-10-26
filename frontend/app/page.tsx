import AppNav from "@/components/AppNav";
import HealthStatus from "@/components/HealthStatus";
import RolePicker from "@/components/home/RolePicker";

export default function Home() {
  return (
    <>
    <AppNav />
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold sm:text-5xl">College Timetable</h1>
        <p className="max-w-xl text-lg text-ink-soft">
          One place for the whole college. The Dean’s office builds a clash-free timetable, teachers and students see their own
          week, and organisers book halls without paper letters.
        </p>
      </div>
      <RolePicker />
      <HealthStatus />
    </main>
    </>
  );
}
