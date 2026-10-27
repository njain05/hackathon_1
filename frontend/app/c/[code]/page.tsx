import type { Metadata } from "next";
import { Suspense } from "react";
import OpenShareLink from "@/components/share/OpenShareLink";
import PageLoading from "@/components/ui/PageLoading";

export const metadata: Metadata = {
  title: "My timetable | College Timetable",
};

/** The public share link: /c/<slug or code>. */
export default function Page({ params }: PageProps<"/c/[code]">) {
  return (
    <Suspense fallback={<PageLoading text="Opening the timetable…" nav={false} />}>
      <Open params={params} />
    </Suspense>
  );
}

async function Open({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <OpenShareLink code={code} />;
}
