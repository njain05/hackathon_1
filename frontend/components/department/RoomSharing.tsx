"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { decideRoomRequest, listRoomRequests, requestRoom, staffId, type RoomRequest, type Staff } from "@/lib/departments";
import type { CollegeData } from "@/lib/types";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Room sharing for one department: ask another department for one of its rooms,
 * see what was asked, and (HOD or Dean) approve or reject requests for its own rooms.
 */
export default function RoomSharing({
  staff,
  dept,
  data,
  canDecide,
  onShared,
}: {
  staff: Staff;
  dept: string;
  /** The setup, to list other departments' rooms. */
  data: CollegeData | null;
  /** The department's HOD or the Dean. */
  canDecide: boolean;
  /** Called after an approval changes the setup (so the caller can reload it). */
  onShared?: () => void;
}) {
  const [requests, setRequests] = useState<RoomRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [room, setRoom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Reload only when the person changes, not when the caller rebuilds the object.
  const staffRef = useRef(staff);
  useEffect(() => {
    staffRef.current = staff;
  });
  const who = staffId(staff);
  const load = useCallback(() => {
    listRoomRequests(staffRef.current)
      .then((r) => {
        setRequests(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Couldn't load room requests."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who]);

  useEffect(() => {
    load();
  }, [load]);

  const askable = (data?.rooms ?? []).filter(
    (r) => r.department_id && r.department_id !== dept && !(r.shared_with ?? []).includes(dept),
  );
  const sharedWithUs = (data?.rooms ?? []).filter((r) => r.department_id !== dept && (r.shared_with ?? []).includes(dept));
  const forUs = (requests ?? []).filter((r) => r.owner_department === dept);
  const fromUs = (requests ?? []).filter((r) => r.for_department === dept);

  const ask = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await requestRoom(staff, room, dept, reason);
      setMessage(`Asked ${r.owner_department}'s HOD for ${r.room_name}.`);
      setRoom("");
      setReason("");
      load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Couldn't send the request. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (r: RoomRequest, approve: boolean) => {
    const note = approve ? "" : window.prompt(`Reject ${r.for_department}'s request for ${r.room_name}? Add a reason (optional):`, "");
    if (note === null) return; // cancelled
    setBusy(true);
    try {
      await decideRoomRequest(staff, r.id, approve, note);
      setMessage(approve ? `${r.room_name} is now shared with ${r.for_department}.` : `Rejected ${r.for_department}'s request for ${r.room_name}.`);
      load();
      if (approve) onShared?.();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4" aria-labelledby="room-sharing">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="room-sharing" className="mr-auto text-lg font-bold">
          Sharing rooms with other departments
        </h2>
        <button type="button" className="btn-quiet !py-1" onClick={load}>
          Refresh
        </button>
      </div>
      {message && (
        <p role="status" className="rounded-md bg-mint px-3 py-2 font-semibold">
          {message}
        </p>
      )}
      {error && <p className="font-semibold text-err">{error}</p>}

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Requests for {dept}&apos;s rooms</h3>
        {forUs.filter((r) => r.status === "pending").length === 0 ? (
          <p className="hint">No department is waiting for one of your rooms.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {forUs
              .filter((r) => r.status === "pending")
              .map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
                  <span className="mr-auto">
                    <span className="font-semibold">{r.for_department}</span> wants <span className="font-semibold">{r.room_name}</span>
                    {r.reason && <span className="text-ink-soft">: {r.reason}</span>}
                    <span className="block text-sm text-ink-soft">
                      Asked by {r.requested_by}, {when(r.created_at)}
                    </span>
                  </span>
                  {canDecide ? (
                    <>
                      <button type="button" className="btn-primary !py-1" disabled={busy} onClick={() => decide(r, true)}>
                        Share it
                      </button>
                      <button type="button" className="btn-quiet !py-1" disabled={busy} onClick={() => decide(r, false)}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-ink-soft">Waiting for your HOD</span>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Ask for another department&apos;s room</h3>
        <p className="hint">For example, an open elective or a big section that needs a bigger room. Their HOD approves it.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="field-label">Room</span>
            <select className="field min-w-56" value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">Choose a room…</option>
              {askable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.id} ({r.department_id}, seats {r.capacity})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="field-label">Why (optional)</span>
            <input className="field" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Open Elective 1 needs 66 seats" />
          </label>
          <button type="button" className="btn-primary" disabled={!room || busy} onClick={ask}>
            Send request
          </button>
        </div>
      </div>

      {(fromUs.length > 0 || sharedWithUs.length > 0) && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">What {dept} asked for</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {fromUs.map((r) => (
              <li key={r.id}>
                <span className="font-semibold">{r.room_name}</span> from {r.owner_department}:{" "}
                {r.status === "pending" ? "waiting for their HOD" : r.status === "approved" ? `shared${r.note ? ` (“${r.note}”)` : ""}` : `rejected${r.note ? `: “${r.note}”` : ""}`}
              </li>
            ))}
          </ul>
          {sharedWithUs.length > 0 && (
            <p className="text-sm">
              Rooms {dept} may also use: <span className="font-semibold">{sharedWithUs.map((r) => r.name || r.id).join(", ")}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
