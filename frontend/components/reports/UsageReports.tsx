"use client";

import { LOW_USE, percent, plural, type RoomUsage, type SectionLoad } from "@/lib/reports";
import { Meter, NoteBadge } from "./Bars";

const ROW = "grid grid-cols-1 gap-x-6 gap-y-1.5 py-3 hover:bg-blush/30 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,15rem)] md:items-center print:break-inside-avoid";

function RoomRow({ r }: { r: RoomUsage }) {
  const low = r.share < LOW_USE;
  return (
    <li className={ROW}>
      <div className="min-w-0">
        <span className="font-semibold break-words">{r.name}</span>{" "}
        <span className="text-sm text-ink-soft">
          {r.name.includes(r.id) ? "" : `${r.id}, `}
          {r.typeName}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <Meter share={r.share} title={`${r.name}: ${r.used} of ${r.slots} periods (${percent(r.share)})`} />
        <span className="w-24 shrink-0 text-sm">
          <span className="text-base font-bold">{percent(r.share)}</span> used
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <span>
          {r.used} of {r.slots} periods
        </span>
        {low && <NoteBadge>Could be freed</NoteBadge>}
      </div>
    </li>
  );
}

function RoomList({ title, rooms, empty }: { title: string; rooms: RoomUsage[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-lg font-bold">{title}</h3>
      {rooms.length === 0 ? (
        <p className="text-ink-soft">{empty}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line" aria-label={title}>
          {rooms.map((r) => (
            <RoomRow key={r.id} r={r} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function RoomReport({ rooms, days, periods }: { rooms: RoomUsage[]; days: number; periods: number }) {
  const slots = days * periods;
  const low = rooms.filter((r) => r.share < LOW_USE).sort((a, b) => a.share - b.share);
  return (
    <section aria-labelledby="rooms" className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="rooms" className="text-xl font-bold">
          Room usage
        </h2>
        <p className="text-ink-soft">
          How much of the teaching week each classroom and lab holds classes. A week has {slots} periods ({days} days ×{" "}
          {periods} periods). Seminar halls and auditoriums aren&apos;t counted: they never hold classes.
        </p>
      </div>

      <div className="rounded-md border border-line bg-mint/40 p-3">
        <h3 id="freed" className="font-bold">
          Could be freed for other uses
        </h3>
        {low.length ? (
          <>
            <p className="text-sm text-ink-soft">Used for less than {percent(LOW_USE)} of the week:</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {low.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{r.name}</span> ({r.typeName}):{" "}
                  {r.used === 0 ? "no classes at all" : `${plural(r.used, "period")} a week, ${percent(r.share)}`}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm">None: every classroom and lab holds classes for at least {percent(LOW_USE)} of the week.</p>
        )}
      </div>

      <RoomList title="Classrooms" rooms={rooms.filter((r) => r.use === "lecture")} empty="No classrooms in this timetable." />
      <RoomList title="Labs" rooms={rooms.filter((r) => r.use === "lab")} empty="No labs in this timetable." />
    </section>
  );
}

function SectionRow({ s }: { s: SectionLoad }) {
  const share = s.slots ? s.periods / s.slots : 0;
  return (
    <li className={ROW}>
      <div className="min-w-0">
        <span className="font-semibold break-words">{s.name}</span>{" "}
        {!s.name.includes(s.id) && <span className="text-sm text-ink-soft">{s.id}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <Meter share={share} title={`${s.name}: ${s.periods} of ${s.slots} periods, ${s.free} free`} />
        <span className="w-24 shrink-0 text-sm">
          <span className="text-base font-bold">{s.periods}</span> of {s.slots}
        </span>
      </div>
      <div className="text-sm text-ink-soft">
        {plural(s.free, "free period")}
        {s.mostFree ? `, most on ${s.mostFree.day} (${s.mostFree.periods})` : ""}
      </div>
    </li>
  );
}

export function SectionReport({ sections, slots }: { sections: SectionLoad[]; slots: number }) {
  return (
    <section aria-labelledby="sections" className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="sections" className="text-xl font-bold">
          Section load
        </h2>
        <p className="text-ink-soft">
          How many periods of class each section has a week, out of {slots}. Free periods are the rest; breaks
          don&apos;t count.
        </p>
      </div>
      {sections.length === 0 ? (
        <p className="text-ink-soft">There are no sections in this timetable.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line" aria-label="Sections">
          {sections.map((s) => (
            <SectionRow key={s.id} s={s} />
          ))}
        </ol>
      )}
    </section>
  );
}
