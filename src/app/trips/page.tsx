"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Terms } from "@/lib/bookings/policy";
import { isFlight, type Booking } from "@/lib/bookings/types";
import type { FlightSegment } from "@/lib/types";

type BookingView = Booking & { cancelTerms: Terms; changeTerms: Terms };

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-IN")}`;
  }
}

const when = (iso: string) => {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", ...(iso.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}) });
};

const STATUS_STYLE = {
  confirmed: "bg-teal-soft text-teal",
  cancelled: "bg-line text-muted",
  disrupted: "bg-saffron-soft text-saffron",
} as const;

function Legs({ label, segments }: { label: string; segments: FlightSegment[] }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      {segments.map((s, i) => (
        <dd key={i} className="mt-0.5">
          {s.carrier} {s.flightNumber}: {s.from} {when(s.departAt)} to {s.to} {when(s.arriveAt)}
        </dd>
      ))}
    </div>
  );
}

function BookingCard({ b, onCancel, onDisrupt, busy }: { b: BookingView; onCancel: (b: BookingView) => void; onDisrupt: (b: BookingView) => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const offer = b.offer;
  // A confirmed booking whose trip has begun is shown as completed: nothing more can be done to it.
  const [now] = useState(() => Date.now());
  const completed = b.status === "confirmed" && Date.parse(isFlight(offer) ? offer.outbound[0].departAt : `${offer.checkIn}T14:00:00`) <= now;
  return (
    <article className="break-inside-avoid rounded-2xl border border-line bg-card p-5 print:border-black">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{b.kind === "flight" ? "Flight confirmation" : "Stay voucher"} · simulated</p>
          <h2 className="mt-1 font-display text-xl">{b.title}</h2>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold tracking-widest">{b.reference}</p>
          <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${completed ? "bg-line text-ink" : STATUS_STYLE[b.status]}`}>{completed ? "completed" : b.status}</span>
        </div>
      </header>

      {b.disruption && (
        <p role="alert" className="mt-3 rounded-xl border border-saffron/40 bg-saffron-soft px-3 py-2 text-sm">
          {b.disruption} Ask Safar in the chat to rebook or cancel it.
        </p>
      )}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {isFlight(offer) ? (
          <>
            <Legs label="Outbound" segments={offer.outbound} />
            {offer.inbound && <Legs label="Return" segments={offer.inbound} />}
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Cabin and bags</dt>
              <dd className="mt-0.5">
                {offer.cabin} · {offer.baggage}
              </dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Stay</dt>
              <dd className="mt-0.5">
                {offer.area}, {offer.city}
              </dd>
              <dd>
                {when(offer.checkIn)} to {when(offer.checkOut)} · {offer.nights} night{offer.nights === 1 ? "" : "s"} · {offer.rooms} room{offer.rooms === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Includes</dt>
              <dd className="mt-0.5">{offer.amenities.join(", ") || "Not listed"}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Travellers</dt>
          <dd className="mt-0.5">{b.travellers.join(", ")}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">{b.status === "cancelled" ? "Paid / refunded" : "Total"}</dt>
          <dd className="mt-0.5 tabular-nums">
            {money(b.totalPrice, b.currency)}
            {b.status === "cancelled" && ` / ${money(b.refundAmount ?? 0, b.currency)}`}
          </dd>
        </div>
      </dl>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted">History and rules</summary>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {b.events.map((e, i) => (
            <li key={i}>
              {when(e.at)}: {e.text}
            </li>
          ))}
          {b.status !== "cancelled" && !completed && (
            <>
              <li>If cancelled now: {b.cancelTerms.explanation}</li>
              <li>If changed now: {b.changeTerms.explanation}</li>
            </>
          )}
        </ul>
      </details>

      {completed && (
        <div className="mt-4 print:hidden">
          <button type="button" onClick={() => window.print()} className="h-9 rounded-lg border border-line px-3 text-sm font-medium hover:border-saffron">
            Print or save as PDF
          </button>
        </div>
      )}
      {b.status !== "cancelled" && !completed && (
        <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
          {confirming ? (
            <>
              <span className="text-sm">
                Cancel {b.reference}? You get back {money(b.cancelTerms.refund, b.currency)}. {b.cancelTerms.explanation} This cannot be undone.
              </span>
              <button type="button" disabled={busy} onClick={() => onCancel(b)} className="h-9 rounded-lg bg-saffron px-3 text-sm font-medium text-white disabled:opacity-50">
                Yes, cancel it
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="h-9 rounded-lg border border-line px-3 text-sm font-medium">
                Keep it
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={!b.cancelTerms.allowed} title={b.cancelTerms.allowed ? undefined : b.cancelTerms.explanation} onClick={() => setConfirming(true)} className="h-9 rounded-lg border border-line px-3 text-sm font-medium hover:border-saffron disabled:opacity-40">
                Cancel booking
              </button>
              <button type="button" onClick={() => window.print()} className="h-9 rounded-lg border border-line px-3 text-sm font-medium hover:border-saffron">
                Print or save as PDF
              </button>
              {b.status === "confirmed" && (
                <button type="button" disabled={busy} onClick={() => onDisrupt(b)} className="h-9 rounded-lg px-3 text-sm text-muted underline-offset-2 hover:underline disabled:opacity-50" title="Demo: pretend the provider cancelled this booking, to try the rebooking flow">
                  Simulate a disruption
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

export default function TripsPage() {
  const [bookings, setBookings] = useState<BookingView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bookings");
      setBookings((await res.json()).bookings ?? []);
    } catch {
      setBookings([]);
      setNotice({ tone: "error", text: "Could not load your bookings. Is the server running?" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const act = async (body: object) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      setNotice(res.ok ? { tone: "ok", text: data.message } : { tone: "error", text: data.error ?? "That did not work." });
      await load();
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card/90 px-4 py-2.5 backdrop-blur sm:px-6 print:hidden">
        <Link href="/" className="font-display text-xl tracking-tight">
          Safar<span className="text-saffron">.</span>
        </Link>
        <span className="text-sm text-muted">My trips</span>
        <Link href="/" className="ml-auto h-9 rounded-lg border border-line bg-card px-3 text-sm font-medium leading-9 hover:border-saffron">
          Back to chat
        </Link>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="font-display text-3xl">My trips</h1>
          <p className="mt-2 text-sm text-muted">
            Confirmations and vouchers for bookings made in Safar. These are simulated: no real reservation exists and no payment was taken. To
            change a booking or rebook after a disruption, ask Safar in the chat.
          </p>
        </div>

        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm print:hidden ${notice.tone === "error" ? "border-saffron/40 bg-saffron-soft" : "border-teal/30 bg-teal-soft"}`}>
            {notice.text}
          </p>
        )}

        {bookings === null ? (
          <p className="text-sm text-muted">Loading your bookings…</p>
        ) : bookings.length === 0 ? (
          <div className="rounded-2xl border border-line bg-card p-8 text-center">
            <p className="font-display text-xl">No bookings yet</p>
            <p className="mt-2 text-sm text-muted">Plan a trip with Safar and ask it to book. You will confirm every booking yourself before it is made.</p>
            <Link href="/" className="mt-4 inline-block h-10 rounded-xl bg-saffron px-4 text-sm font-medium leading-10 text-white">
              Plan a trip
            </Link>
          </div>
        ) : (
          bookings.map((b) => (
            <BookingCard key={b.id} b={b} busy={busy} onCancel={(x) => void act({ op: "cancel", reference: x.reference })} onDisrupt={(x) => void act({ op: "disrupt", bookingId: x.id })} />
          ))
        )}
      </main>
    </div>
  );
}
