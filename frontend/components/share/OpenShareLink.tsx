"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setViewedCollege } from "@/lib/cloud";

/** Remember the college from a share link on this device, then show My timetable. */
export default function OpenShareLink({ code }: { code: string }) {
  const router = useRouter();
  useEffect(() => {
    setViewedCollege(code);
    router.replace("/my");
  }, [code, router]);
  return <p className="p-8 text-ink-soft">Opening the timetable…</p>;
}
