import type { StayOffer } from "@/lib/types";
import { ProviderError, type StayProvider, type StaySearch } from "../types";
import { findPlace, fromInr, isIsoDate, nightsBetween, seeded } from "./places";

// Invented property names, clearly fictional so nobody mistakes them for real hotels.
const TEMPLATES: { name: string; kind: StayOffer["kind"]; stars: number; baseInr: number; amenities: string[] }[] = [
  { name: "Backpackers' Courtyard (sample)", kind: "hostel", stars: 2, baseInr: 1100, amenities: ["Wi-Fi", "Shared kitchen", "Lockers"] },
  { name: "Neem Tree Homestay (sample)", kind: "homestay", stars: 3, baseInr: 2600, amenities: ["Wi-Fi", "Breakfast", "Home-cooked meals"] },
  { name: "Saffron Lane Hotel (sample)", kind: "hotel", stars: 3, baseInr: 3800, amenities: ["Wi-Fi", "Breakfast", "AC", "Airport pickup on request"] },
  { name: "The Verandah Suites (sample)", kind: "apartment", stars: 4, baseInr: 5400, amenities: ["Wi-Fi", "Kitchenette", "Washer", "AC"] },
  { name: "Indigo Bay Hotel (sample)", kind: "hotel", stars: 4, baseInr: 7200, amenities: ["Wi-Fi", "Breakfast", "Pool", "Gym"] },
  { name: "Palace Gardens Resort (sample)", kind: "resort", stars: 5, baseInr: 14500, amenities: ["Wi-Fi", "Breakfast", "Pool", "Spa", "Airport transfer"] },
];

export class MockStayProvider implements StayProvider {
  readonly name = "mock";

  async searchStays(q: StaySearch): Promise<StayOffer[]> {
    if (!isIsoDate(q.checkIn) || !isIsoDate(q.checkOut)) throw new ProviderError("Dates must be YYYY-MM-DD.");
    const nights = nightsBetween(q.checkIn, q.checkOut);
    if (nights < 1) throw new ProviderError("checkOut must be after checkIn.");
    // Cities outside the built-in list still get sample stays, with generic areas and no map position.
    const known = findPlace(q.city);
    const name = q.city.trim();
    if (!name) throw new ProviderError("A city is needed to search for stays.");
    const place = known ?? {
      city: name.replace(/\b\w/g, (c) => c.toUpperCase()),
      iata: name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "CITY",
      costIndex: 1,
      areas: ["City centre", "Old town", "Near the railway station", "Airport road"],
      lat: undefined as number | undefined,
      lng: undefined as number | undefined,
    };

    const rooms = q.rooms ?? Math.max(1, Math.ceil(q.guests / 2));
    const rand = seeded(`${place.iata}-${q.checkIn}-${q.checkOut}`);
    const offers = TEMPLATES.map((t, i): StayOffer => {
      const area = place.areas[Math.floor(rand() * place.areas.length)];
      const perNight = fromInr(t.baseInr * place.costIndex * (0.9 + rand() * 0.3), q.currency);
      return {
        id: `mock-stay-${place.iata}-${q.checkIn.replace(/-/g, "")}-${i + 1}`,
        source: "mock",
        name: t.name,
        city: place.city,
        area,
        kind: t.kind,
        stars: t.stars,
        rating: Math.round((7 + rand() * 2.4) * 10) / 10,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        nights,
        rooms,
        pricePerNight: perNight,
        totalPrice: perNight * nights * rooms,
        currency: q.currency.toUpperCase(),
        amenities: t.amenities,
        lat: place.lat === undefined ? undefined : Math.round((place.lat + (rand() - 0.5) * 0.06) * 1e4) / 1e4,
        lng: place.lng === undefined ? undefined : Math.round((place.lng + (rand() - 0.5) * 0.06) * 1e4) / 1e4,
      };
    });
    const filtered = q.maxPricePerNight ? offers.filter((o) => o.pricePerNight <= q.maxPricePerNight!) : offers;
    return filtered.sort((a, b) => a.pricePerNight - b.pricePerNight);
  }
}
