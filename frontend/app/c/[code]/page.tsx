import type { Metadata } from "next";
import { Suspense } from "react";
import OpenShareLink from "@/components/share/OpenShareLink";

export const metadata: Metadata = {
  title: "My timetable | College Timetable",
};

/** The public share link: /c/<slug or code>. */
export default function Page({ params }: PageProps<"/c/[code]">) {
  return (
    <Suspense fallback={<p className="p-8 text-ink-soft">Opening the timetable…</p>}>
      <Open params={params} />
    </Suspense>
  );
}

async function Open({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <OpenShareLink code={code} />;
}
