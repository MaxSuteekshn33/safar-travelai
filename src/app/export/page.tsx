"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ItineraryPanel } from "@/components/ItineraryPanel";
import type { Booking } from "@/lib/bookings/types";
import type { BudgetSummary, Itinerary } from "@/lib/types";

interface Loaded {
  itinerary: Itinerary;
  budget: BudgetSummary;
  bookings: Booking[];
}

/** A clean, full-length copy of one itinerary for printing or saving as a PDF. */
export default function ExportPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    void (async () => {
      if (!id) return setError("No trip was selected to export.");
      try {
        const [c, b] = await Promise.all([
          fetch(`/api/conversations?id=${encodeURIComponent(id)}`),
          fetch(`/api/bookings?conversationId=${encodeURIComponent(id)}`),
        ]);
        if (!c.ok) throw new Error();
        const conv = await c.json();
        const book = b.ok ? await b.json() : { bookings: [] };
        setData({ itinerary: conv.itinerary, budget: conv.budget, bookings: book.bookings ?? [] });
        document.title = `${conv.itinerary?.trip?.title ?? "Itinerary"} - Safar`;
      } catch {
        setError("That trip could not be loaded. It may have been deleted.");
      }
    })();
  }, []);

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-3 border-b border-line px-5 py-3 print:hidden">
        <Link href="/" className="font-display text-xl tracking-tight">
          Safar<span className="text-saffron">.</span>
        </Link>
        <p className="min-w-0 flex-1 text-sm text-muted">In the print dialog, choose &ldquo;Save as PDF&rdquo; as the destination.</p>
        <button type="button" disabled={!data} onClick={() => window.print()} className="h-9 rounded-lg bg-saffron px-4 text-sm font-medium text-white disabled:opacity-40">
          Print or save as PDF
        </button>
      </div>
      <main className="mx-auto max-w-2xl pb-10">
        {error ? (
          <p role="alert" className="m-5 rounded-xl border border-saffron/40 bg-saffron-soft px-4 py-3 text-sm">
            {error}
          </p>
        ) : !data ? (
          <p className="m-5 text-sm text-muted">Loading the itinerary…</p>
        ) : (
          <>
            <ItineraryPanel itinerary={data.itinerary} budget={data.budget} bookings={data.bookings} printable />
            <p className="px-5 pt-4 text-xs text-muted">
              Prepared with Safar on {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Items marked sample or test data are not
              real fares or properties. Transfer costs are estimates. Bookings made inside Safar are simulated.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
