"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import PageLoading from "@/components/ui/PageLoading";
import { ApiError } from "@/lib/api";
import { getCollege, setViewedCollege } from "@/lib/cloud";
import { OpenCollegePage } from "./OpenCollege";

/**
 * Open a share link: check the college first, then remember it on this device
 * and show My timetable. A wrong or unpublished link is explained here and never
 * saved, so it can't get stuck on the other pages.
 */
export default function OpenShareLink({ code }: { code: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getCollege(code)
      .then((c) => {
        if (!live) return;
        if (c.published_version === null) {
          setProblem(`${c.name} hasn’t published its timetable yet. Ask the Dean’s office to publish it, then open the link again.`);
          return;
        }
        setViewedCollege(c.code);
        router.replace("/my");
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.cause === 404) {
          setProblem(e.message);
          return;
        }
        // Offline or the server is down: keep the link, so the saved copy (if any) still shows.
        setViewedCollege(code);
        router.replace("/my");
      });
    return () => {
      live = false;
    };
  }, [code, router]);

  if (!problem) return <PageLoading text="Opening the timetable…" />;
  return (
    <>
      <AppNav />
      <OpenCollegePage error={problem} />
    </>
  );
}
