import type { StayOffer } from "@/lib/types";
import { roundMoney, type FxProvider } from "../fx";
import { isIsoDate, nightsBetween } from "../mock/places";
import { ProviderError, type StayProvider, type StaySearch } from "../types";
import { DuffelFeatureUnavailable, type DuffelClient } from "./client";

// Field names follow Duffel's Stays search documentation. This adapter has
// not been run against a live account: Stays must be enabled by Duffel, and
// on accounts without it the provider below falls back to the mock.
interface DuffelStayResult {
  id: string;
  check_in_date: string;
  check_out_date: string;
  rooms: number;
  cheapest_rate_total_amount: string;
  cheapest_rate_currency: string;
  accommodation: {
    name: string;
    type?: string | null;
    rating?: number | null;
    review_score?: number | null;
    amenities?: { type: string; description: string }[] | null;
    location?: {
      geographic_coordinates?: { latitude: number; longitude: number } | null;
      address?: { line_one?: string; city_name?: string; region?: string } | null;
    } | null;
  };
}

export type Geocoder = (city: string) => Promise<{ lat: number; lng: number; name: string } | null>;

const KINDS: Record<string, StayOffer["kind"]> = { hotel: "hotel", resort: "resort", hostel: "hostel", apartment: "apartment", guest_house: "homestay", bed_and_breakfast: "homestay" };

export class DuffelStayProvider implements StayProvider {
  private unavailable = false;

  constructor(
    private client: DuffelClient,
    private fx: FxProvider,
    private geocode: Geocoder,
    private fallback: StayProvider,
  ) {}

  /** Reports "mock" once we have learnt that Stays is not enabled on the account. */
  get name(): string {
    return this.unavailable ? this.fallback.name : "duffel";
  }

  async searchStays(q: StaySearch): Promise<StayOffer[]> {
    if (this.unavailable) return this.fallback.searchStays(q);
    if (!isIsoDate(q.checkIn) || !isIsoDate(q.checkOut)) throw new ProviderError("Dates must be YYYY-MM-DD.");
    const nights = nightsBetween(q.checkIn, q.checkOut);
    if (nights < 1) throw new ProviderError("checkOut must be after checkIn.");
    const place = await this.geocode(q.city);
    if (!place) throw new ProviderError(`Could not locate "${q.city}" to search for stays.`);
    const rooms = q.rooms ?? Math.max(1, Math.ceil(q.guests / 2));

    let data: { results: DuffelStayResult[] };
    try {
      data = await this.client.request("POST", "/stays/search", {
        rooms,
        location: { radius: 10, geographic_coordinates: { latitude: place.lat, longitude: place.lng } },
        check_in_date: q.checkIn,
        check_out_date: q.checkOut,
        guests: Array(q.guests).fill({ type: "adult" }),
      });
    } catch (err) {
      if (err instanceof DuffelFeatureUnavailable) {
        // Stays is not switched on for this account: use the mock from now on.
        this.unavailable = true;
        return this.fallback.searchStays(q);
      }
      throw err;
    }

    const currency = q.currency.toUpperCase();
    const offers: StayOffer[] = [];
    for (const r of data.results ?? []) {
      const fx = await this.fx.quote(r.cheapest_rate_currency, currency);
      const total = roundMoney(Number(r.cheapest_rate_total_amount) * fx.rate, currency);
      const a = r.accommodation;
      const notes: string[] = [];
      if (this.client.testMode) notes.push("Duffel test mode: not a real rate.");
      if (fx.source !== "same") notes.push(`Converted from ${r.cheapest_rate_currency} ${r.cheapest_rate_total_amount}${fx.source === "ecb" ? "" : " at an approximate rate"}.`);
      offers.push({
        id: r.id,
        source: "duffel",
        testMode: this.client.testMode,
        name: a.name,
        city: a.location?.address?.city_name ?? place.name,
        area: a.location?.address?.line_one ?? a.location?.address?.region ?? place.name,
        kind: KINDS[a.type ?? ""] ?? "hotel",
        stars: a.rating ?? 0,
        rating: a.review_score ?? 0,
        checkIn: r.check_in_date,
        checkOut: r.check_out_date,
        nights,
        rooms: r.rooms ?? rooms,
        pricePerNight: roundMoney(total / nights / (r.rooms ?? rooms), currency),
        totalPrice: total,
        currency,
        amenities: (a.amenities ?? []).map((x) => x.description).slice(0, 6),
        lat: a.location?.geographic_coordinates?.latitude,
        lng: a.location?.geographic_coordinates?.longitude,
        notes,
      });
    }
    const filtered = q.maxPricePerNight ? offers.filter((o) => o.pricePerNight <= q.maxPricePerNight!) : offers;
    return filtered.sort((x, y) => x.totalPrice - y.totalPrice).slice(0, 8);
  }
}
