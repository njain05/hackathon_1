import AppNav from "@/components/AppNav";

/**
 * A page that is still reading what this device remembers (or opening a link):
 * the top bar stays where it will be, and "Loading…" shows only if it takes a moment.
 */
export default function PageLoading({ text = "Loading…", nav = true }: { text?: string; nav?: boolean }) {
  return (
    <>
      {/* No top bar while a server page prerenders (it reads the address, which needs Suspense there). */}
      {nav && <AppNav />}
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <p role="status" className="appear-late text-ink-soft">
          {text}
        </p>
      </main>
    </>
  );
}
