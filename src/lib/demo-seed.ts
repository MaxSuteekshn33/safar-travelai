import type { PrismaClient } from "@prisma/client";
import type { Booking } from "./bookings/types";
import type { FlightOffer, FlightSegment, Itinerary, ItineraryDay, StayOffer, TravelerProfile } from "./types";

// Sample history for a demo: a saved traveller profile, two past trips and
// one upcoming trip, each with simulated bookings. Everything here is
// fictional and is dated relative to "now" so it always reads as history.
// It is added to an empty hosted (temporary) database, or locally when
// SAFAR_DEMO_DATA=1. Set SAFAR_DEMO_DATA=0 to switch it off everywhere.

const DAY = 86_400_000;
const TRAVELLERS = ["Aarav Mehta", "Diya Mehta"];
const SAMPLE_NOTE = "Sample history added for the demo: fictional.";

export interface DemoTrip {
  id: string;
  /** When the trip was planned and booked. */
  plannedAt: string;
  itinerary: Itinerary;
  messages: { role: "user" | "assistant"; text: string }[];
  bookings: (Omit<Booking, "id" | "createdAt"> & { createdAt: string })[];
}

export interface DemoData {
  profile: TravelerProfile;
  trips: DemoTrip[];
}

export function demoDataEnabled(ephemeral: boolean, env: Record<string, string | undefined> = process.env): boolean {
  if (env.SAFAR_DEMO_DATA === "0") return false;
  return ephemeral || env.SAFAR_DEMO_DATA === "1";
}

export function buildDemoData(now: number = Date.now()): DemoData {
  const date = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString().slice(0, 10);
  const stamp = (offsetDays: number, hour = 10) => `${date(offsetDays)}T${String(hour).padStart(2, "0")}:15:00.000Z`;
  const monthYear = (offsetDays: number) => new Date(now + offsetDays * DAY).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  const seg = (carrier: string, flightNumber: string, from: string, to: string, day: number, depart: string, arrive: string): FlightSegment => ({
    carrier,
    flightNumber,
    from,
    to,
    departAt: `${date(day)}T${depart}`,
    arriveAt: `${date(day)}T${arrive}`,
  });

  const flight = (id: string, out: FlightSegment, back: FlightSegment, durationMinutes: number, totalPrice: number): FlightOffer => ({
    id,
    source: "mock",
    origin: out.from,
    destination: out.to,
    outbound: [out],
    inbound: [back],
    stops: 0,
    durationMinutes,
    cabin: "economy",
    baggage: "1 checked bag + 1 cabin bag",
    travellers: TRAVELLERS.length,
    totalPrice,
    currency: "INR",
    notes: [SAMPLE_NOTE],
  });

  const stay = (
    id: string,
    name: string,
    city: string,
    area: string,
    kind: StayOffer["kind"],
    startDay: number,
    nights: number,
    pricePerNight: number,
    pos: [number, number],
    amenities: string[],
  ): StayOffer => ({
    id,
    source: "mock",
    name: `${name} (sample)`,
    city,
    area,
    kind,
    stars: 4,
    rating: 8.7,
    checkIn: date(startDay),
    checkOut: date(startDay + nights),
    nights,
    rooms: 1,
    pricePerNight,
    totalPrice: pricePerNight * nights,
    currency: "INR",
    amenities,
    lat: pos[0],
    lng: pos[1],
    notes: [SAMPLE_NOTE],
  });

  const days = (startDay: number, plan: [string, string[]][]): ItineraryDay[] =>
    plan.map(([title, items], i) => ({
      day: i + 1,
      date: date(startDay + i),
      title,
      items: items.map((t) => ({ title: t, kind: "experience" as const, unverified: true })),
    }));

  const describeFlight = (f: FlightOffer) =>
    `${f.outbound[0].carrier} ${f.origin} to ${f.destination}, ${f.outbound[0].departAt.replace("T", " ")}, returning ${f.inbound![0].departAt.replace("T", " ")}`;
  const describeStay = (s: StayOffer) => `${s.name}, ${s.city}, ${s.checkIn} to ${s.checkOut} (${s.nights} nights)`;

  const booking = (conversationId: string, reference: string, offer: FlightOffer | StayOffer, bookedDay: number, extra: Partial<Booking> = {}): DemoTrip["bookings"][number] => {
    const isFlight = "outbound" in offer;
    return {
      reference,
      conversationId,
      kind: isFlight ? "flight" : "stay",
      status: "confirmed",
      title: isFlight ? describeFlight(offer) : describeStay(offer),
      travellers: TRAVELLERS,
      totalPrice: offer.totalPrice,
      currency: offer.currency,
      offer,
      simulated: true,
      events: [{ at: stamp(bookedDay), text: "Booked (simulated)." }],
      createdAt: stamp(bookedDay),
      ...extra,
    };
  };

  const trip = (
    id: string,
    title: string,
    destination: string,
    startDay: number,
    nights: number,
    plannedDay: number,
    f: FlightOffer,
    s: StayOffer,
    plan: ItineraryDay[],
    budgetTotal: number,
    ask: string,
    reply: string,
    bookings: DemoTrip["bookings"],
  ): DemoTrip => ({
    id,
    plannedAt: stamp(plannedDay),
    itinerary: {
      trip: { title, origin: "Delhi", destination, startDate: date(startDay), endDate: date(startDay + nights), travellers: TRAVELLERS.length, currency: "INR", budgetTotal },
      flights: [f],
      stays: [s],
      transfers: [],
      days: plan,
      otherCosts: [{ label: "Food and local travel", amount: nights * 4500, isEstimate: true }],
      bookingLinks: [],
    },
    messages: [
      { role: "user", text: ask },
      { role: "assistant", text: reply },
    ],
    bookings,
  });

  // 1. Goa, about four months ago. The first stay was cancelled and replaced.
  const goaStart = -124;
  const goaFlight = flight("demo-flight-goa", seg("IndiGo", "6E 2135", "DEL", "GOI", goaStart, "07:10", "09:45"), seg("IndiGo", "6E 2136", "GOI", "DEL", goaStart + 4, "18:20", "20:55"), 155, 21800);
  const goaFirstStay = stay("demo-stay-goa-first", "Baga Shore Hotel", "Goa", "Baga", "hotel", goaStart, 4, 5200, [15.5553, 73.7517], ["Breakfast", "Pool"]);
  const goaStay = stay("demo-stay-goa", "Casa Assagao Homestay", "Goa", "Assagao", "homestay", goaStart, 4, 6400, [15.5975, 73.7647], ["Breakfast", "Pool", "Garden"]);
  const goa = trip(
    "demo-trip-goa",
    "Goa long weekend",
    "Goa",
    goaStart,
    4,
    goaStart - 21,
    goaFlight,
    goaStay,
    days(goaStart, [
      ["Arrive and settle in Assagao", ["Lunch near the stay", "Sunset at Vagator"]],
      ["North Goa beaches", ["Morning at Ashwem", "Evening in Anjuna"]],
      ["Old Goa and Panjim", ["Churches of Old Goa", "Fontainhas walk"]],
      ["Slow day", ["Pool morning", "Dinner in Assagao"]],
    ]),
    70000,
    "A long weekend in Goa for two of us from Delhi. Quiet, good vegetarian food, not the party strip.",
    "All set for Goa. You fly IndiGo from Delhi in the morning and stay four nights at a homestay in Assagao, which is quieter than Baga and close to good vegetarian kitchens. You first booked a hotel in Baga, then switched; that booking was cancelled with a full refund. Both current bookings are confirmed and are under My trips.",
    [
      booking("demo-trip-goa", "GQ7K2M", goaFlight, goaStart - 21),
      booking("demo-trip-goa", "HX4P9T", goaFirstStay, goaStart - 21, {
        status: "cancelled",
        refundAmount: goaFirstStay.totalPrice,
        events: [
          { at: stamp(goaStart - 21), text: "Booked (simulated)." },
          { at: stamp(goaStart - 19, 14), text: `Cancelled. Refund INR ${goaFirstStay.totalPrice.toLocaleString("en-IN")} (simulated).` },
        ],
      }),
      booking("demo-trip-goa", "KD3W8R", goaStay, goaStart - 19),
    ],
  );

  // 2. Jaipur, about five weeks ago.
  const jaiStart = -37;
  const jaiFlight = flight("demo-flight-jaipur", seg("Air India", "AI 1719", "DEL", "JAI", jaiStart, "08:25", "09:25"), seg("Air India", "AI 1720", "JAI", "DEL", jaiStart + 3, "19:40", "20:45"), 60, 11600);
  const jaiStay = stay("demo-stay-jaipur", "Haveli Gulab Niwas", "Jaipur", "Old City", "hotel", jaiStart, 3, 7800, [26.9239, 75.8267], ["Breakfast", "Courtyard", "Rooftop restaurant"]);
  const jaipur = trip(
    "demo-trip-jaipur",
    "Jaipur heritage weekend",
    "Jaipur",
    jaiStart,
    3,
    jaiStart - 12,
    jaiFlight,
    jaiStay,
    days(jaiStart, [
      ["Old City on foot", ["City Palace", "Evening in the bazaars"]],
      ["Forts", ["Amber Fort early", "Sunset at Nahargarh"]],
      ["Easy last day", ["Breakfast at the haveli", "Shopping before the flight"]],
    ]),
    55000,
    "Three days in Jaipur for our anniversary. A heritage stay, relaxed pace, vegetarian.",
    "Booked. You fly Air India in the morning and stay three nights at a heritage haveli in the Old City, a short walk from the City Palace. I kept the days light, with the forts on day two. Both bookings are confirmed and are under My trips.",
    [booking("demo-trip-jaipur", "JM6N4B", jaiFlight, jaiStart - 12), booking("demo-trip-jaipur", "LT8C5V", jaiStay, jaiStart - 12)],
  );

  // 3. Kerala, three weeks from now, so changes and cancellations can be shown.
  const kerStart = 23;
  const kerFlight = flight("demo-flight-kochi", seg("IndiGo", "6E 6701", "DEL", "COK", kerStart, "06:40", "09:55"), seg("IndiGo", "6E 6702", "COK", "DEL", kerStart + 5, "17:30", "20:45"), 195, 27400);
  const kerStay = stay("demo-stay-kochi", "Backwater Courtyard Resort", "Kochi", "Kumbalangi", "resort", kerStart, 5, 8900, [9.8724, 76.2867], ["Breakfast", "Pool", "Backwater view"]);
  const kerala = trip(
    "demo-trip-kerala",
    "Kerala backwaters",
    "Kochi",
    kerStart,
    5,
    -6,
    kerFlight,
    kerStay,
    days(kerStart, [
      ["Arrive in Kochi", ["Check in by the backwaters", "Quiet evening at the resort"]],
      ["Fort Kochi", ["Heritage walk", "Sunset by the fishing nets"]],
      ["Backwaters", ["Day on a houseboat near Alleppey"]],
      ["Slow day", ["Village walk in Kumbalangi", "Pool afternoon"]],
      ["Last day", ["Spice shopping in Mattancherry", "Evening flight home"]],
    ]),
    110000,
    "Five nights in Kerala next month for the two of us. Backwaters, slow days, a nice resort.",
    "Your Kerala trip is booked. You fly IndiGo to Kochi in the morning and stay five nights at a backwater resort in Kumbalangi, with one day on a houseboat near Alleppey. Both bookings are confirmed and are under My trips. Tell me if you want to change dates or cancel anything.",
    [booking("demo-trip-kerala", "NB2Y7F", kerFlight, -6), booking("demo-trip-kerala", "PR5H3X", kerStay, -6)],
  );

  const profile: TravelerProfile = {
    name: "Aarav",
    homeCity: "Delhi",
    budgetStyle: "comfort",
    dietary: "Vegetarian",
    pace: "relaxed",
    airlineLikes: ["Morning departures", "Aisle seat", "IndiGo or Air India"],
    hotelLikes: ["Heritage and boutique stays", "A pool", "Quiet areas over nightlife"],
    interests: ["Food walks", "Forts and old towns", "Beaches"],
    notes: ["Usually travels with partner Diya", "Avoids late-night flights"],
    pastTrips: [
      { destination: "Goa", when: monthYear(goaStart), note: "Stayed in Assagao; liked it more than Baga." },
      { destination: "Jaipur", when: monthYear(jaiStart), note: "Anniversary trip; loved the heritage haveli." },
    ],
  };

  return { profile, trips: [goa, jaipur, kerala] };
}

/**
 * Writes the sample history once. It does nothing if sample trips or any
 * bookings already exist, and never overwrites a saved profile.
 */
export async function seedDemoData(db: PrismaClient, now: number = Date.now()): Promise<boolean> {
  const [bookings, sampleTrips] = await Promise.all([db.booking.count(), db.conversation.count({ where: { id: { startsWith: "demo-trip-" } } })]);
  if (bookings > 0 || sampleTrips > 0) return false;

  const data = buildDemoData(now);
  for (const t of data.trips) {
    const at = new Date(t.plannedAt);
    await db.conversation.create({ data: { id: t.id, title: t.itinerary.trip.title, itinerary: JSON.stringify(t.itinerary), createdAt: at, updatedAt: at } });
    for (const m of t.messages) {
      await db.message.create({ data: { conversationId: t.id, role: m.role, content: JSON.stringify([{ type: "text", text: m.text }]), createdAt: at } });
    }
    for (const offer of [...t.itinerary.flights, ...t.itinerary.stays]) {
      await db.offer.create({ data: { id: `${t.id}:${offer.id}`, conversationId: t.id, kind: "outbound" in offer ? "flight" : "stay", data: JSON.stringify(offer), createdAt: at } });
    }
    for (const b of t.bookings) {
      const { createdAt, ...rest } = b;
      await db.booking.create({ data: { reference: b.reference, conversationId: b.conversationId, kind: b.kind, status: b.status, data: JSON.stringify(rest), createdAt: new Date(createdAt) } });
    }
  }
  const existing = await db.profile.findUnique({ where: { id: 1 } });
  if (!existing || existing.data === "{}") {
    const json = JSON.stringify(data.profile);
    await db.profile.upsert({ where: { id: 1 }, create: { id: 1, data: json }, update: { data: json } });
  }
  return true;
}
