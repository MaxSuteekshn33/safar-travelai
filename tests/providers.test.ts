import { describe, expect, it } from "vitest";
import { buildFlightLinks, buildStayLinks } from "@/lib/booking-links";
import { getProviders } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

const OFFLINE = { SAFAR_OFFLINE: "1" } as unknown as NodeJS.ProcessEnv;
const p = getProviders(OFFLINE);

describe("provider selection", () => {
  it("uses mocks when no provider keys are set", () => {
    expect(p.flights.name).toBe("mock");
    expect(p.stays.name).toBe("mock");
    expect(p.research.name).toBe("mock");
    expect(p.weather.name).toBe("mock");
    expect(p.transfers.name).toBe("estimate");
  });
});

describe("mock flights", () => {
  const q = { origin: "Delhi", destination: "GOI", departDate: "2026-12-18", returnDate: "2026-12-22", adults: 2, currency: "INR" };

  it("returns priced round-trip offers, cheapest first, labelled as mock", async () => {
    const offers = await p.flights.searchFlights(q);
    expect(offers.length).toBeGreaterThanOrEqual(3);
    for (const o of offers) {
      expect(o.source).toBe("mock");
      expect(o.origin).toBe("DEL");
      expect(o.destination).toBe("GOI");
      expect(o.travellers).toBe(2);
      expect(o.totalPrice).toBeGreaterThan(0);
      expect(o.inbound?.length).toBeGreaterThan(0);
      expect(o.outbound[0].departAt.startsWith("2026-12-18")).toBe(true);
    }
    const prices = offers.map((o) => o.totalPrice);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("is deterministic for the same search", async () => {
    expect(await p.flights.searchFlights(q)).toEqual(await p.flights.searchFlights(q));
  });

  it("scales price with travellers and omits inbound for one-way", async () => {
    const one = await p.flights.searchFlights({ ...q, returnDate: undefined, adults: 1 });
    const two = await p.flights.searchFlights({ ...q, returnDate: undefined, adults: 2 });
    expect(one[0].inbound).toBeUndefined();
    expect(two[0].totalPrice).toBeGreaterThan(one[0].totalPrice * 1.8);
  });

  it("rejects unknown places and bad dates with a readable error", async () => {
    await expect(p.flights.searchFlights({ ...q, destination: "Atlantis" })).rejects.toBeInstanceOf(ProviderError);
    await expect(p.flights.searchFlights({ ...q, departDate: "18 Dec" })).rejects.toBeInstanceOf(ProviderError);
    await expect(p.flights.searchFlights({ ...q, returnDate: "2026-12-01" })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("mock stays", () => {
  const q = { city: "Goa", checkIn: "2026-12-18", checkOut: "2026-12-22", guests: 2, currency: "INR" };

  it("computes nights and totals consistently", async () => {
    const offers = await p.stays.searchStays(q);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.nights).toBe(4);
      expect(o.totalPrice).toBe(o.pricePerNight * o.nights * o.rooms);
      expect(o.name).toContain("(sample)");
    }
  });

  it("applies the price cap", async () => {
    const offers = await p.stays.searchStays({ ...q, maxPricePerNight: 4000 });
    expect(offers.every((o) => o.pricePerNight <= 4000)).toBe(true);
  });

  it("still returns sample stays for a city outside the built-in list, without map positions", async () => {
    const offers = await p.stays.searchStays({ ...q, city: "amritsar" });
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.city === "Amritsar" && o.source === "mock" && o.lat === undefined)).toBe(true);
  });

  it("rejects a checkout on or before check-in", async () => {
    await expect(p.stays.searchStays({ ...q, checkOut: "2026-12-18" })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("transfer estimates", () => {
  it("labels every leg as an estimate and uses coordinates when given", async () => {
    const [airport, walk] = await p.transfers.estimate(
      "Goa",
      [
        { from: "Goa airport (GOI)", to: "Hotel in Candolim" },
        { from: "A", to: "B", fromLat: 15.5, fromLng: 73.8, toLat: 15.501, toLng: 73.801 },
      ],
      "INR",
    );
    expect(airport.isEstimate).toBe(true);
    expect(airport.source).toBe("estimate");
    expect(airport.mode).toBe("cab");
    expect(airport.cost).toBeGreaterThan(0);
    expect(walk.distanceKm).toBeLessThan(1);
    expect(walk.mode).toBe("walk");
    expect(walk.cost).toBe(0);
  });
});

describe("mock research", () => {
  it("marks every sample recommendation unverified and without a source", async () => {
    const r = await p.research.research({ destination: "Goa" });
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.every((x) => x.verified === false && !x.sourceUrl)).toBe(true);
  });

  it("returns nothing, with a warning, for places it has no notes on", async () => {
    const r = await p.research.research({ destination: "Timbuktu" });
    expect(r.recommendations).toEqual([]);
    expect(r.note).toMatch(/Do not invent/);
  });
});

describe("mock weather", () => {
  it("returns one day per date and says it is not a forecast", async () => {
    const w = await p.weather.getWeather("Goa", "2026-12-18", "2026-12-22");
    expect(w.days.map((d) => d.date)).toEqual(["2026-12-18", "2026-12-19", "2026-12-20", "2026-12-21", "2026-12-22"]);
    expect(w.kind).toBe("climate-normal");
    expect(w.days.every((d) => d.minC < d.maxC)).toBe(true);
  });
});

describe("booking links", () => {
  it("builds pre-filled flight searches with route, dates and passengers", () => {
    const { links } = buildFlightLinks({ origin: "Delhi", destination: "Goa", departDate: "2026-12-18", returnDate: "2026-12-22", adults: 2 });
    const by = Object.fromEntries(links.map((l) => [l.site, l.url]));
    expect(by.Skyscanner).toContain("/transport/flights/del/goi/261218/261222/");
    expect(by.Skyscanner).toContain("adultsv2=2");
    expect(decodeURIComponent(by.MakeMyTrip)).toContain("itinerary=DEL-GOI-18/12/2026_GOI-DEL-22/12/2026");
    expect(by.MakeMyTrip).toContain("tripType=R");
    expect(by.ixigo).toContain("from=DEL&to=GOI&date=18122026&returnDate=22122026&adults=2");
    expect(links.every((l) => l.url.startsWith("https://"))).toBe(true);
  });

  it("marks the checked flight patterns as verified", () => {
    const { links } = buildFlightLinks({ origin: "Delhi", destination: "Goa", departDate: "2026-12-18", adults: 1 });
    expect(links.map((l) => [l.site, l.verified])).toEqual([["Skyscanner", true], ["MakeMyTrip", true], ["ixigo", true]]);
    expect(links.find((l) => l.site === "MakeMyTrip")!.url).toContain("tripType=O");
  });

  it("builds stay searches, using MakeMyTrip's city code only where we know it", () => {
    const stays = buildStayLinks({ city: "Goa", checkIn: "2026-12-18", checkOut: "2026-12-22", adults: 2 }).links;
    expect(stays.find((l) => l.site === "Airbnb")!.url).toContain("/s/Goa/homes?checkin=2026-12-18&checkout=2026-12-22&adults=2");
    const mmt = stays.find((l) => l.site === "MakeMyTrip")!;
    expect(mmt.url).toContain("checkin=12182026&checkout=12222026&city=CTGOI&country=IN&locusId=CTGOI&locusType=city&roomStayQualifier=2e0e&searchText=Goa");
    expect(mmt.verified).toBe(true);

    const abroad = buildStayLinks({ city: "Bangkok", checkIn: "2026-12-18", checkOut: "2026-12-22", adults: 2 }).links.find((l) => l.site === "MakeMyTrip")!;
    expect(abroad).toMatchObject({ url: "https://www.makemytrip.com/hotels/", verified: false });
  });

  it("refuses to guess airport codes", () => {
    const none = buildFlightLinks({ origin: "Some Village", destination: "Goa", departDate: "2026-12-18", adults: 1 });
    expect(none.links).toEqual([]);
    expect(none.note).toBeTruthy();
  });
});
