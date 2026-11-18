import type { FlightOffer, FlightSegment } from "@/lib/types";
import { roundMoney, type FxProvider } from "../fx";
import { findPlace, isIsoDate } from "../mock/places";
import { ProviderError, type FlightProvider, type FlightSearch } from "../types";
import type { DuffelClient } from "./client";

// Only the fields we read. Shapes confirmed against the live test API.
interface DuffelSegment {
  departing_at: string;
  arriving_at: string;
  marketing_carrier_flight_number: string;
  marketing_carrier: { iata_code: string; name: string };
  origin: { iata_code: string };
  destination: { iata_code: string };
  passengers?: { cabin_class?: string; baggages?: { type: string; quantity: number }[] }[];
}
interface DuffelSlice {
  duration: string | null;
  segments: DuffelSegment[];
}
interface DuffelCondition {
  allowed: boolean;
  penalty_amount: string | null;
  penalty_currency: string | null;
}
export interface DuffelOffer {
  id: string;
  live_mode: boolean;
  expires_at?: string;
  total_amount: string;
  total_currency: string;
  owner: { iata_code: string; name: string };
  slices: DuffelSlice[];
  passengers: unknown[];
  conditions?: { change_before_departure?: DuffelCondition | null; refund_before_departure?: DuffelCondition | null } | null;
}
interface DuffelPlace {
  type: "airport" | "city";
  iata_code: string;
  iata_city_code?: string | null;
  name: string;
  city_name?: string | null;
}

/** "PT2H35M" or "P1DT1H5M" to minutes. */
export function isoDurationToMinutes(d: string | null | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/.exec(d ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const MAX_OFFERS = 6;

export class DuffelFlightProvider implements FlightProvider {
  readonly name = "duffel";
  private iataCache = new Map<string, string>();

  constructor(
    private client: DuffelClient,
    private fx: FxProvider,
  ) {}

  /** City name or code to an IATA code: local list first, then Duffel's place search. */
  async resolveIata(place: string): Promise<string> {
    const q = place.trim();
    const local = findPlace(q);
    if (local) return local.iata;
    if (/^[A-Za-z]{3}$/.test(q)) return q.toUpperCase();
    const key = q.toLowerCase();
    const cached = this.iataCache.get(key);
    if (cached) return cached;
    const places = await this.client.request<DuffelPlace[]>("GET", `/places/suggestions?query=${encodeURIComponent(q)}`, undefined, 15000);
    // Only accept a match on the city itself; the service also returns loose matches (Jaipur -> Raipur).
    const match = places.find((p) => (p.city_name ?? p.name).toLowerCase() === key) ?? places.find((p) => p.name.toLowerCase().startsWith(key));
    if (!match) throw new ProviderError(`Could not find an airport for "${place}". Ask the traveller for the nearest airport.`);
    const code = match.type === "city" ? match.iata_code : (match.iata_city_code ?? match.iata_code);
    this.iataCache.set(key, code);
    return code;
  }

  async searchFlights(q: FlightSearch): Promise<FlightOffer[]> {
    if (!isIsoDate(q.departDate)) throw new ProviderError("departDate must be YYYY-MM-DD.");
    if (q.returnDate && !isIsoDate(q.returnDate)) throw new ProviderError("returnDate must be YYYY-MM-DD.");
    if (q.returnDate && q.returnDate < q.departDate) throw new ProviderError("returnDate is before departDate.");
    const [origin, destination] = await Promise.all([this.resolveIata(q.origin), this.resolveIata(q.destination)]);
    if (origin === destination) throw new ProviderError("Origin and destination are the same.");

    const children = q.children ?? 0;
    const slices = [{ origin, destination, departure_date: q.departDate }];
    if (q.returnDate) slices.push({ origin: destination, destination: origin, departure_date: q.returnDate });

    const data = await this.client.request<{ offers: DuffelOffer[] }>(
      "POST",
      "/air/offer_requests?return_offers=true&supplier_timeout=20000",
      {
        slices,
        passengers: [...Array(q.adults).fill({ type: "adult" }), ...Array(children).fill({ age: 8 })],
        cabin_class: q.cabin ?? "economy",
        max_connections: 1,
      },
    );

    const currency = q.currency.toUpperCase();
    const cheapest = [...(data.offers ?? [])].sort((a, b) => Number(a.total_amount) - Number(b.total_amount)).slice(0, MAX_OFFERS);
    const out: FlightOffer[] = [];
    for (const offer of cheapest) out.push(await this.toOffer(offer, origin, destination, currency, q));
    return out;
  }

  private async toOffer(o: DuffelOffer, origin: string, destination: string, currency: string, q: FlightSearch): Promise<FlightOffer> {
    const leg = (slice: DuffelSlice): FlightSegment[] =>
      slice.segments.map((s) => ({
        carrier: s.marketing_carrier.name,
        flightNumber: `${s.marketing_carrier.iata_code} ${s.marketing_carrier_flight_number}`,
        from: s.origin.iata_code,
        to: s.destination.iata_code,
        departAt: s.departing_at.slice(0, 16),
        arriveAt: s.arriving_at.slice(0, 16),
      }));
    const outbound = leg(o.slices[0]);
    const inbound = o.slices[1] ? leg(o.slices[1]) : undefined;
    const firstPax = o.slices[0].segments[0]?.passengers?.[0];
    const bags = firstPax?.baggages ?? [];
    const count = (type: string) => bags.filter((b) => b.type === type).reduce((n, b) => n + b.quantity, 0);
    const checked = count("checked");
    const cabinBags = count("carry_on");
    const baggage =
      [checked ? `${checked} checked bag${checked > 1 ? "s" : ""}` : "no checked bag", cabinBags ? `${cabinBags} cabin bag${cabinBags > 1 ? "s" : ""}` : null]
        .filter(Boolean)
        .join(" + ");

    const amount = Number(o.total_amount);
    const fx = await this.fx.quote(o.total_currency, currency);
    const notes: string[] = [];
    if (!o.live_mode) notes.push("Duffel test mode: a fictional test offer, not a real fare.");
    if (fx.source !== "same") {
      notes.push(
        `Converted from ${o.total_currency} ${o.total_amount} at ${fx.rate.toFixed(2)}` +
          (fx.source === "ecb" ? ` (reference rate${fx.date ? ` of ${fx.date}` : ""}).` : " (approximate rate)."),
      );
    }
    const last = outbound[outbound.length - 1];
    if (Number(last.arriveAt.slice(11, 13)) < 5) notes.push(`Lands at ${last.arriveAt.slice(11)} local time.`);
    if (outbound.length > 1) notes.push(`One stop in ${outbound[0].to}.`);
    const refund = o.conditions?.refund_before_departure;
    const change = o.conditions?.change_before_departure;
    if (refund) notes.push(refund.allowed ? `Refundable before departure${refund.penalty_amount ? ` for a ${refund.penalty_currency} ${refund.penalty_amount} fee` : ""}.` : "Not refundable.");
    if (change) notes.push(change.allowed ? `Changes allowed${change.penalty_amount ? ` for a ${change.penalty_currency} ${change.penalty_amount} fee` : ""}.` : "Changes not allowed.");

    const fee = async (c: DuffelCondition | null | undefined) => {
      if (!c?.allowed || !c.penalty_amount) return 0;
      const q = await this.fx.quote(c.penalty_currency ?? o.total_currency, currency);
      return roundMoney(Number(c.penalty_amount) * q.rate, currency);
    };
    const conditions = o.conditions
      ? { refundable: !!refund?.allowed, refundFee: await fee(refund), changeable: !!change?.allowed, changeFee: await fee(change) }
      : undefined;

    return {
      id: o.id,
      source: "duffel",
      conditions,
      testMode: !o.live_mode,
      expiresAt: o.expires_at,
      origin,
      destination,
      outbound,
      inbound,
      stops: outbound.length - 1,
      durationMinutes: isoDurationToMinutes(o.slices[0].duration),
      cabin: firstPax?.cabin_class ?? q.cabin ?? "economy",
      baggage,
      travellers: o.passengers.length,
      totalPrice: roundMoney(amount * fx.rate, currency),
      currency,
      notes,
    };
  }
}
