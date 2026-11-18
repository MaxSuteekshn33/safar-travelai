"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { Booking } from "@/lib/bookings/types";
import type { BudgetSummary, FlightOffer, FlightSegment, Itinerary, ItineraryItem, StayOffer } from "@/lib/types";
import { MapView, type MapStop } from "./MapView";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}

function prettyDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

const time = (iso: string) => iso.slice(11, 16);
const duration = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-5 first:border-t-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tag({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "teal"; children: ReactNode }) {
  const cls =
    tone === "warn" ? "bg-saffron-soft text-saffron" : tone === "teal" ? "bg-teal-soft text-teal" : "bg-paper text-muted";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function BookedTag({ booking }: { booking?: Booking }) {
  if (!booking) return null;
  if (booking.status === "confirmed") return <Tag tone="teal">booked · {booking.reference}</Tag>;
  return <Tag tone="warn">{booking.status} · {booking.reference}</Tag>;
}

function Leg({ label, segments }: { label: string; segments: FlightSegment[] }) {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const nextDay = last.arriveAt.slice(0, 10) !== first.departAt.slice(0, 10);
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 font-medium tabular-nums">
          <span>{time(first.departAt)}</span>
          <span className="text-xs font-normal text-muted">{first.from}</span>
          <span aria-hidden className="h-px flex-1 bg-line" />
          <span>
            {time(last.arriveAt)}
            {nextDay && <sup className="ml-0.5 text-[10px] text-saffron">+1</sup>}
          </span>
          <span className="text-xs font-normal text-muted">{last.to}</span>
        </div>
        <p className="truncate text-xs text-muted">
          {prettyDate(first.departAt)} · {segments.map((s) => `${s.carrier} ${s.flightNumber}`).join(", ")}
          {segments.length > 1 && ` · via ${segments[0].to}`}
        </p>
      </div>
    </div>
  );
}

function FlightCard({ f, booking }: { f: FlightOffer; booking?: Booking }) {
  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <div className="space-y-3">
        <Leg label="Out" segments={f.outbound} />
        {f.inbound && <Leg label="Back" segments={f.inbound} />}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{f.stops === 0 ? "Non-stop" : `${f.stops} stop`}</span>·<span>{duration(f.durationMinutes)}</span>·
          <span>{f.baggage}</span>
          {f.source === "mock" && <Tag tone="warn">sample data</Tag>}
          {f.testMode && <Tag tone="warn">test data</Tag>}
          <BookedTag booking={booking} />
        </div>
        <p className="font-medium tabular-nums">
          {money(f.totalPrice, f.currency)}
          <span className="ml-1 text-xs font-normal text-muted">for {f.travellers}</span>
        </p>
      </div>
      {f.notes?.length ? <p className="mt-2 text-xs text-muted">{f.notes.join(" ")}</p> : null}
    </article>
  );
}

function StayCard({ s, booking }: { s: StayOffer; booking?: Booking }) {
  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium leading-snug">{s.name}</h3>
          <p className="text-xs text-muted">
            {s.area}, {s.city} · {s.kind} · {"★".repeat(s.stars)} · {s.rating}/10
          </p>
        </div>
        {s.source === "mock" && <Tag tone="warn">sample data</Tag>}
        {s.testMode && <Tag tone="warn">test data</Tag>}
        <BookedTag booking={booking} />
      </div>
      <p className="mt-2 text-xs text-muted">{s.amenities.join(" · ")}</p>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-sm">
        <span className="text-xs text-muted">
          {prettyDate(s.checkIn)} to {prettyDate(s.checkOut)} · {s.nights} night{s.nights === 1 ? "" : "s"} · {s.rooms} room
          {s.rooms === 1 ? "" : "s"}
        </span>
        <span className="font-medium tabular-nums">
          {money(s.totalPrice, s.currency)}
          <span className="ml-1 text-xs font-normal text-muted">({money(s.pricePerNight, s.currency)}/night)</span>
        </span>
      </div>
    </article>
  );
}

const KIND_MARK: Record<ItineraryItem["kind"], string> = {
  sight: "◆",
  food: "●",
  transfer: "→",
  flight: "✈",
  stay: "⌂",
  experience: "✦",
  free: "○",
};

function safeHttpUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function Budget({ budget }: { budget: BudgetSummary }) {
  const over = budget.remaining !== undefined && budget.remaining < 0;
  const pct = budget.budgetTotal ? Math.min(100, Math.round((budget.total / budget.budgetTotal) * 100)) : null;
  return (
    <div>
      <p className="font-display text-3xl tabular-nums">{money(budget.total, budget.currency)}</p>
      {budget.budgetTotal !== undefined ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`${pct}% of budget planned`}>
            <div className={`h-full rounded-full ${over ? "bg-saffron" : "bg-teal"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className={`mt-1.5 text-xs ${over ? "font-medium text-saffron" : "text-muted"}`}>
            {over
              ? `${money(-budget.remaining!, budget.currency)} over your ${money(budget.budgetTotal, budget.currency)} budget`
              : `${money(budget.remaining!, budget.currency)} left of ${money(budget.budgetTotal, budget.currency)}`}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted">Planned so far. Tell Safar your budget to track against it.</p>
      )}
      <dl className="mt-3 space-y-1.5 text-sm">
        {budget.lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">
              {l.label} {l.isEstimate && <Tag>estimate</Tag>}
            </dt>
            <dd className="tabular-nums">{money(l.amount, budget.currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ItineraryPanel({
  itinerary,
  budget,
  bookings = [],
  exportHref,
  printable = false,
}: {
  itinerary: Itinerary;
  budget: BudgetSummary;
  bookings?: Booking[];
  /** Link to the printable version; shown as an Export button. */
  exportHref?: string;
  /** Full-height layout for printing: no inner scrolling, no map tiles. */
  printable?: boolean;
}) {
  const { trip, flights, stays, transfers, days, bookingLinks } = itinerary;
  const currency = budget.currency;

  const stops = useMemo<MapStop[]>(() => {
    const out: MapStop[] = [];
    for (const s of stays) {
      if (typeof s.lat === "number" && typeof s.lng === "number") {
        out.push({ label: "H", title: s.name, lat: s.lat, lng: s.lng, kind: "stay" });
      }
    }
    for (const d of days) {
      for (const item of d.items) {
        if (typeof item.lat === "number" && typeof item.lng === "number") {
          out.push({ label: String(d.day), title: `Day ${d.day}: ${item.title}`, lat: item.lat, lng: item.lng, kind: "stop" });
        }
      }
    }
    return out;
  }, [stays, days]);

  const isEmpty =
    !trip.destination && !trip.title && !flights.length && !stays.length && !days.length && !transfers.length && !bookingLinks.length && !bookings.length;

  if (isEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="font-display text-2xl">Your plan will take shape here</p>
        <p className="mt-2 max-w-xs text-sm text-muted">
          Flights, stays, a day-by-day plan, the running budget and a map appear as you and Safar decide things.
        </p>
      </div>
    );
  }

  const subtitle = [
    trip.origin && trip.destination ? `${trip.origin} to ${trip.destination}` : trip.destination,
    trip.startDate && `${prettyDate(trip.startDate)}${trip.endDate ? ` to ${prettyDate(trip.endDate)}` : ""}`,
    trip.travellers && `${trip.travellers} traveller${trip.travellers === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={printable ? "" : "h-full overflow-y-auto"}>
      <header className="px-5 pb-1 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-saffron">Itinerary</p>
          {exportHref && (
            <Link href={exportHref} target="_blank" className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-medium hover:border-saffron">
              Export PDF
            </Link>
          )}
        </div>
        <h1 className="mt-1 font-display text-2xl leading-tight">{trip.title ?? trip.destination ?? "Your trip"}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </header>

      {(budget.lines.length > 0 || budget.budgetTotal !== undefined) && (
        <Section title="Budget">
          <Budget budget={budget} />
        </Section>
      )}

      {flights.length > 0 && (
        <Section title="Flights">
          <div className="space-y-3">
            {flights.map((f) => (
              <FlightCard key={f.id} f={f} booking={bookings.find((b) => b.offer.id === f.id)} />
            ))}
          </div>
        </Section>
      )}

      {stays.length > 0 && (
        <Section title="Stays">
          <div className="space-y-3">
            {stays.map((s) => (
              <StayCard key={s.id} s={s} booking={bookings.find((b) => b.offer.id === s.id)} />
            ))}
          </div>
        </Section>
      )}

      {days.length > 0 && (
        <Section title="Day by day">
          <ol className="space-y-5">
            {days.map((d) => (
              <li key={d.day}>
                <div className="flex items-baseline gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-saffron text-xs font-semibold text-white">
                    {d.day}
                  </span>
                  <h3 className="font-medium">{d.title}</h3>
                  {d.date && <span className="ml-auto shrink-0 text-xs text-muted">{prettyDate(d.date)}</span>}
                </div>
                <ul className="ml-3 mt-2 space-y-2.5 border-l border-line pl-5">
                  {d.items.map((item, i) => {
                    const url = safeHttpUrl(item.sourceUrl);
                    return (
                      <li key={i} className="text-sm">
                        <div className="flex items-baseline gap-2">
                          <span aria-hidden className="w-3 shrink-0 text-center text-xs text-teal">
                            {KIND_MARK[item.kind]}
                          </span>
                          {item.time && <span className="shrink-0 text-xs tabular-nums text-muted">{item.time}</span>}
                          <span className="min-w-0 flex-1">{item.title}</span>
                          {typeof item.cost === "number" && item.cost > 0 && (
                            <span className="shrink-0 text-xs tabular-nums text-muted">
                              {item.costIsEstimate !== false && "~"}
                              {money(item.cost, currency)}
                            </span>
                          )}
                        </div>
                        {(item.note || item.unverified || url) && (
                          <p className="ml-5 mt-0.5 text-xs text-muted">
                            {item.note}{" "}
                            {item.unverified && <Tag tone="warn">unverified</Tag>}{" "}
                            {url && (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="text-teal underline underline-offset-2">
                                {item.sourceTitle ? `source: ${item.sourceTitle.slice(0, 60)}` : "source"}
                              </a>
                            )}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {transfers.length > 0 && (
        <Section title="Transfers" aside={<Tag>estimates, not quotes</Tag>}>
          <ul className="space-y-2 text-sm">
            {transfers.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  {t.from} <span aria-hidden>→</span> {t.to}
                  <span className="block text-xs text-muted">
                    about {t.distanceKm} km · {t.durationMinutes} min by {t.mode}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">~{money(t.cost, t.currency)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {stops.length > 0 && !printable && (
        <Section title="Map" aside={<span className="text-xs text-muted">pin positions are approximate</span>}>
          <MapView stops={stops} />
        </Section>
      )}

      {bookings.length > 0 && (
        <Section title="Bookings" aside={<Tag>simulated</Tag>}>
          <ul className="space-y-2 text-sm">
            {bookings.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-medium tabular-nums">{b.reference}</span> <span className="text-muted">{b.title}</span>
                  {b.disruption && <span className="block text-xs text-saffron">{b.disruption}</span>}
                </span>
                <Tag tone={b.status === "confirmed" ? "teal" : "warn"}>{b.status}</Tag>
              </li>
            ))}
          </ul>
          <Link href="/trips" className="mt-3 inline-block text-sm text-teal underline underline-offset-2">
            Open My trips for confirmations and changes
          </Link>
        </Section>
      )}

      {bookingLinks.length > 0 && (
        <Section title="Compare and book">
          <p className="mb-3 text-xs text-muted">
            To book for real, use these: each opens a search on that site, pre-filled with your route, dates and travellers. Bookings made inside Safar are simulated.
          </p>
          <ul className="space-y-2">
            {bookingLinks.map((l) => {
              const url = safeHttpUrl(l.url);
              if (!url) return null;
              return (
                <li key={`${l.site}-${l.kind}`}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm transition hover:border-teal"
                  >
                    <span>
                      <span className="font-medium">{l.site}</span>
                      <span className="ml-1.5 text-xs text-muted">{l.kind}</span>
                    </span>
                    {printable && <span className="hidden min-w-0 flex-1 truncate text-xs text-muted print:inline">{url}</span>}
                    <span className="flex items-center gap-1.5">
                      {!l.verified && <span className="whitespace-nowrap"><Tag>opens the site, search not pre-filled</Tag></span>}
                      <span aria-hidden>↗</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
