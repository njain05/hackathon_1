import Link from "next/link";
import HealthStatus from "@/components/HealthStatus";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-bold sm:text-5xl">College Timetable</h1>
      <p className="max-w-xl text-lg text-ink-soft">
        One place for the whole college. Admins build a clash-free timetable, teachers and students see their own
        week, and organisers book halls without paper letters.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/setup" className="btn-primary !px-5 !py-3 !text-base">
          Set up your college
        </Link>
        <Link href="/timetable" className="btn-quiet !px-5 !py-3 !text-base">
          See timetables
        </Link>
        <Link href="/my" className="btn-quiet !px-5 !py-3 !text-base">
          My timetable
        </Link>
        <HealthStatus />
      </div>
    </main>
  );
}
