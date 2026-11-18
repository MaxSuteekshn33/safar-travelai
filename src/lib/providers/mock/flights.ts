import type { FlightOffer, FlightSegment } from "@/lib/types";
import { ProviderError, type FlightProvider, type FlightSearch } from "../types";
import { findPlace, fromInr, haversineKm, isIsoDate, seeded, type Place } from "./places";

const DOMESTIC = [
  { name: "IndiGo", code: "6E", premium: 1.0 },
  { name: "Air India", code: "AI", premium: 1.15 },
  { name: "Akasa Air", code: "QP", premium: 0.95 },
  { name: "Air India Express", code: "IX", premium: 0.9 },
  { name: "SpiceJet", code: "SG", premium: 0.88 },
];
const INTERNATIONAL = [
  { name: "Air India", code: "AI", premium: 1.0 },
  { name: "IndiGo", code: "6E", premium: 0.85 },
  { name: "Emirates", code: "EK", premium: 1.25 },
  { name: "Singapore Airlines", code: "SQ", premium: 1.3 },
  { name: "Qatar Airways", code: "QR", premium: 1.2 },
];
const HUBS = ["DEL", "BOM", "BLR", "DXB", "SIN"];
const CABIN_MULT = { economy: 1, premium_economy: 1.6, business: 3.2, first: 5 } as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function addMinutes(date: string, hhmm: number, minutes: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(hhmm + minutes);
  return `${d.toISOString().slice(0, 10)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function buildLeg(
  rand: () => number,
  airline: { name: string; code: string },
  from: Place,
  to: Place,
  date: string,
  departMin: number,
  via: Place | undefined,
): { segments: FlightSegment[]; duration: number } {
  const num = () => `${airline.code} ${100 + Math.floor(rand() * 899)}`;
  const flightMin = (a: Place, b: Place) => Math.round(40 + (haversineKm(a.lat, a.lng, b.lat, b.lng) / 780) * 60);
  if (!via) {
    const dur = flightMin(from, to);
    return {
      duration: dur,
      segments: [
        {
          carrier: airline.name,
          flightNumber: num(),
          from: from.iata,
          to: to.iata,
          departAt: addMinutes(date, departMin, 0),
          arriveAt: addMinutes(date, departMin, dur),
        },
      ],
    };
  }
  const first = flightMin(from, via);
  const layover = 70 + Math.floor(rand() * 150);
  const second = flightMin(via, to);
  return {
    duration: first + layover + second,
    segments: [
      {
        carrier: airline.name,
        flightNumber: num(),
        from: from.iata,
        to: via.iata,
        departAt: addMinutes(date, departMin, 0),
        arriveAt: addMinutes(date, departMin, first),
      },
      {
        carrier: airline.name,
        flightNumber: num(),
        from: via.iata,
        to: to.iata,
        departAt: addMinutes(date, departMin, first + layover),
        arriveAt: addMinutes(date, departMin, first + layover + second),
      },
    ],
  };
}

export class MockFlightProvider implements FlightProvider {
  readonly name = "mock";

  async searchFlights(q: FlightSearch): Promise<FlightOffer[]> {
    const from = findPlace(q.origin);
    const to = findPlace(q.destination);
    if (!from) throw new ProviderError(`The mock flight provider does not know the origin "${q.origin}".`);
    if (!to) throw new ProviderError(`The mock flight provider does not know the destination "${q.destination}".`);
    if (from.iata === to.iata) throw new ProviderError("Origin and destination are the same.");
    if (!isIsoDate(q.departDate)) throw new ProviderError("departDate must be YYYY-MM-DD.");
    if (q.returnDate && !isIsoDate(q.returnDate)) throw new ProviderError("returnDate must be YYYY-MM-DD.");
    if (q.returnDate && q.returnDate < q.departDate) throw new ProviderError("returnDate is before departDate.");

    const travellers = q.adults + (q.children ?? 0);
    const cabin = q.cabin ?? "economy";
    const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
    const domestic = from.country === to.country;
    const airlines = domestic ? DOMESTIC : INTERNATIONAL;
    const rand = seeded(`${from.iata}-${to.iata}-${q.departDate}-${q.returnDate ?? ""}-${cabin}`);

    // One-way economy base fare per person in INR, by distance.
    const base = (domestic ? 2200 : 6500) + km * (domestic ? 3.6 : 4.4);
    const departSlots = [5 * 60 + 40, 8 * 60 + 15, 13 * 60 + 5, 18 * 60 + 30, 22 * 60 + 50];
    const offers: FlightOffer[] = [];

    for (let i = 0; i < 5; i++) {
      const airline = airlines[Math.floor(rand() * airlines.length)];
      const viaCandidates = HUBS.map(findPlace).filter(
        // Domestic trips only connect through domestic hubs.
        (h): h is Place => !!h && h.iata !== from.iata && h.iata !== to.iata && (!domestic || h.country === from.country),
      );
      const withStop = i >= 3 || (!domestic && km > 5500 && i >= 1);
      const via = withStop ? viaCandidates[Math.floor(rand() * viaCandidates.length)] : undefined;
      const depart = departSlots[i] + Math.floor(rand() * 40);
      const out = buildLeg(rand, airline, from, to, q.departDate, depart, via);
      const back = q.returnDate
        ? buildLeg(rand, airline, to, from, q.returnDate, departSlots[(i + 2) % 5] + Math.floor(rand() * 40), via)
        : undefined;

      const lateNight = depart < 6 * 60 + 30 || depart > 22 * 60;
      const mult =
        airline.premium * CABIN_MULT[cabin] * (via ? 0.82 : 1) * (lateNight ? 0.88 : 1) * (0.92 + rand() * 0.3);
      const perPersonInr = base * mult * (back ? 1.9 : 1);
      const notes: string[] = [];
      const arriveHour = Number(out.segments[out.segments.length - 1].arriveAt.slice(11, 13));
      if (arriveHour < 5) notes.push(`Lands at ${out.segments[out.segments.length - 1].arriveAt.slice(11)} local time.`);
      if (depart < 6 * 60 + 30) notes.push("Very early departure.");
      if (via) notes.push(`One stop in ${via.city}.`);

      offers.push({
        id: `mock-flt-${from.iata}${to.iata}-${q.departDate.replace(/-/g, "")}-${i + 1}`,
        source: "mock",
        origin: from.iata,
        destination: to.iata,
        outbound: out.segments,
        inbound: back?.segments,
        stops: via ? 1 : 0,
        durationMinutes: out.duration,
        cabin,
        baggage: airline.premium >= 1.15 ? "25 kg checked + 7 kg cabin" : "15 kg checked + 7 kg cabin",
        travellers,
        totalPrice: fromInr(perPersonInr * travellers, q.currency),
        currency: q.currency.toUpperCase(),
        notes,
      });
    }
    return offers.sort((a, b) => a.totalPrice - b.totalPrice);
  }
}
