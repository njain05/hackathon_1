"use client";

import {
  assignmentsTable,
  electivesTable,
  roomsTable,
  sectionsTable,
  subjectsTable,
  teachersTable,
} from "@/lib/tables";
import type { CollegeData, RoomUse } from "@/lib/types";
import DataTable from "./DataTable";

interface Props {
  data: CollegeData;
  onChange: (d: CollegeData) => void;
}

const USE_LABEL: Record<RoomUse, string> = {
  lecture: "Lectures",
  lab: "Labs",
  event: "Events only (never classes)",
};

function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "room_type";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  return id;
}

function RoomTypes({ data, onChange }: Props) {
  const inUse = (id: string) => data.rooms.some((r) => r.type === id) || data.subjects.some((s) => s.lab_room_type === id);
  return (
    <details className="rounded-md border border-line bg-paper p-4">
      <summary className="cursor-pointer font-semibold">Advanced options: room types</summary>
      <p className="hint mt-2">
        Every college names its rooms differently. Say what each kind of room is used for. Rooms marked “Events only”
        are kept free for seminars and functions.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {data.room_types.map((t, i) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Room type name"
              value={t.name}
              onChange={(e) =>
                onChange({ ...data, room_types: data.room_types.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
              }
              className="field w-48"
            />
            <select
              aria-label={`What ${t.name} rooms are used for`}
              value={t.use}
              onChange={(e) =>
                onChange({
                  ...data,
                  room_types: data.room_types.map((x, j) => (j === i ? { ...x, use: e.target.value as RoomUse } : x)),
                })
              }
              className="field"
            >
              {(Object.keys(USE_LABEL) as RoomUse[]).map((u) => (
                <option key={u} value={u}>
                  {USE_LABEL[u]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-quiet !px-2 !py-1"
              disabled={inUse(t.id)}
              title={inUse(t.id) ? "Some rooms or subjects use this type" : undefined}
              onClick={() => onChange({ ...data, room_types: data.room_types.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              const taken = new Set(data.room_types.map((t) => t.id));
              const name = "New room type";
              onChange({ ...data, room_types: [...data.room_types, { id: slug(name, taken), name, use: "lecture" }] });
            }}
          >
            Add a room type
          </button>
        </div>
      </div>
    </details>
  );
}

export function StepRooms({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <DataTable spec={roomsTable} data={data} onChange={onChange} emptyText="No rooms yet. Add classrooms, labs and halls, or paste your room list from Excel." />
      <RoomTypes data={data} onChange={onChange} />
    </div>
  );
}

export function StepTeachers({ data, onChange }: Props) {
  return <DataTable spec={teachersTable} data={data} onChange={onChange} emptyText="No teachers yet. Add them one by one, or paste the staff list from Excel." />;
}

export function StepSections({ data, onChange }: Props) {
  return <DataTable spec={sectionsTable} data={data} onChange={onChange} emptyText="No sections yet. A section is one group of students who attend classes together, like CSE-3A." />;
}

export function StepSubjects({ data, onChange }: Props) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Subjects</h2>
        <DataTable spec={subjectsTable} data={data} onChange={onChange} emptyText="No subjects yet. Add each subject with its weekly lectures and lab periods." />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Who teaches what</h2>
        <p className="hint">
          One row for each subject a section studies, with its teacher. This is usually the department’s load sheet.
        </p>
        <DataTable spec={assignmentsTable} data={data} onChange={onChange} emptyText="Nothing assigned yet. Paste your load sheet (Section, Subject, Teacher) or add rows." />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Open electives (optional)</h2>
        <p className="hint max-w-3xl">
          When students of several sections each choose one subject from a group, all choices run at the same time, each with its own
          teacher and room. One row per choice. Rooms come from the subject’s department, shared rooms, or rooms another department’s
          HOD has shared (Rooms → Advanced options → “Also used by”).
        </p>
        <DataTable spec={electivesTable} data={data} onChange={onChange} emptyText="No open electives. Add a row for each choice, e.g. OE-1, CSE-5A ECE-5A, 3 periods, AI for Everyone, Prof. Rajesh Kumar, 50 students." />
      </div>
    </div>
  );
}
