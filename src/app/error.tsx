"use client";

/** Shown if a page crashes while rendering, so the traveller is never left with a blank screen. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center px-6">
      <h1 className="font-display text-3xl">Something went wrong on this page</h1>
      <p className="mt-3 text-sm text-muted">Your trips and profile are saved. Reloading usually fixes it.</p>
      <button type="button" onClick={reset} className="mt-5 h-10 rounded-xl bg-saffron px-4 text-sm font-medium text-white">
        Reload this page
      </button>
    </main>
  );
}
