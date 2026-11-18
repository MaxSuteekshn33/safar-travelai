import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProviders } from "@/lib/providers";
import { DuffelClient } from "@/lib/providers/duffel/client";
import { DuffelFlightProvider, isoDurationToMinutes } from "@/lib/providers/duffel/flights";
import { DuffelStayProvider } from "@/lib/providers/duffel/stays";
import { FrankfurterFxProvider, StaticFxProvider } from "@/lib/providers/fx";
import type { Fetch } from "@/lib/providers/http";
import { MockStayProvider } from "@/lib/providers/mock/stays";
import { OpenMeteoWeatherProvider } from "@/lib/providers/real/open-meteo";
import { ProviderError } from "@/lib/providers/types";

// A real (trimmed) response from Duffel's test API for DEL-GOI return, two adults.
const OFFER_FIXTURE = readFileSync(new URL("./fixtures/duffel-offer-request.json", import.meta.url), "utf8");

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake fetch that answers by URL substring and records every call. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown } | (() => never)>) {
  const calls: Call[] = [];
  const impl: Fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected request to ${url}`);
    const route = routes[key];
    if (typeof route === "function") return route();
    const text = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(text, { status: route.status ?? 200 });
  };
  return { impl, calls };
}

const fx = new StaticFxProvider();
const flightQuery = { origin: "Delhi", destination: "Goa", departDate: "2026-12-18", returnDate: "2026-12-22", adults: 2, currency: "INR" };

describe("provider selection by environment", () => {
  const none: Fetch = async () => { throw new Error("no network in this test"); };
  it("switches flights and stays to Duffel only when a token is set", () => {
    const without = buildProviders({} as NodeJS.ProcessEnv, none);
    expect([without.flights.name, without.stays.name]).toEqual(["mock", "mock"]);
    expect(without.weather.name).toBe("open-meteo"); // free, no key needed
    const withToken = buildProviders({ DUFFEL_ACCESS_TOKEN: "duffel_test_x" } as unknown as NodeJS.ProcessEnv, none);
    expect([withToken.flights.name, withToken.stays.name]).toEqual(["duffel", "duffel"]);
    expect(withToken.research.name).toBe("mock");
  });
  it("forces every source to its mock when SAFAR_OFFLINE=1", () => {
    const p = buildProviders({ DUFFEL_ACCESS_TOKEN: "duffel_test_x", SAFAR_OFFLINE: "1" } as unknown as NodeJS.ProcessEnv, none);
    expect([p.flights.name, p.stays.name, p.weather.name]).toEqual(["mock", "mock", "mock"]);
  });
});

describe("Duffel flights adapter", () => {
  it("sends a well-formed offer request with auth and version headers", async () => {
    const net = fakeFetch({ "/air/offer_requests": { status: 201, body: OFFER_FIXTURE } });
    await new DuffelFlightProvider(new DuffelClient("duffel_test_abc", net.impl), fx).searchFlights({ ...flightQuery, children: 1, cabin: "business" });
    const call = net.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain("https://api.duffel.com/air/offer_requests?return_offers=true");
    expect(call.headers.Authorization).toBe("Bearer duffel_test_abc");
    expect(call.headers["Duffel-Version"]).toBe("v2");
    expect(call.body).toEqual({
      data: {
        slices: [
          { origin: "DEL", destination: "GOI", departure_date: "2026-12-18" },
          { origin: "GOI", destination: "DEL", departure_date: "2026-12-22" },
        ],
        passengers: [{ type: "adult" }, { type: "adult" }, { age: 8 }],
        cabin_class: "business",
        max_connections: 1,
      },
    });
  });

  it("maps a real response into offers, cheapest first, converted and labelled as test data", async () => {
    const net = fakeFetch({ "/air/offer_requests": { status: 201, body: OFFER_FIXTURE } });
    const offers = await new DuffelFlightProvider(new DuffelClient("duffel_test_abc", net.impl), fx).searchFlights(flightQuery);

    expect(offers).toHaveLength(2);
    const [first] = offers;
    expect(first).toMatchObject({
      source: "duffel", testMode: true, origin: "DEL", destination: "GOI", stops: 0,
      durationMinutes: 155, cabin: "economy", travellers: 2, currency: "INR", baggage: "1 checked bag + 1 cabin bag",
    });
    expect(first.id).toMatch(/^off_/);
    expect(first.outbound[0]).toEqual({ carrier: "Duffel Airways", flightNumber: "ZZ 5414", from: "DEL", to: "GOI", departAt: "2026-12-18T13:09", arriveAt: "2026-12-18T15:44" });
    expect(first.inbound?.[0].from).toBe("GOI");
    // USD 260.96 at the static 93 rate, rounded to the nearest 10 rupees.
    expect(first.totalPrice).toBe(24270);
    expect(offers[0].totalPrice).toBeLessThanOrEqual(offers[1].totalPrice);
    expect(first.notes!.join(" ")).toContain("fictional test offer");
    expect(first.notes!.join(" ")).toContain("Converted from USD 260.96");
    expect(first.notes!.join(" ")).toContain("Refundable before departure for a USD 40.00 fee");
    expect(first.notes!.join(" ")).toContain("Changes not allowed");
    // USD 40 refund fee at 93, in rupees; changes are not allowed on this fare.
    expect(first.conditions).toEqual({ refundable: true, refundFee: 3720, changeable: false, changeFee: 0 });
  });

  it("looks up an airport for a city it does not know, and refuses a loose match", async () => {
    const net = fakeFetch({
      "query=Gaya": { body: { data: [{ type: "airport", iata_code: "GAY", iata_city_code: "GAY", city_name: "Gaya", name: "Gaya Airport" }] } },
      "query=Nowhereville": { body: { data: [{ type: "airport", iata_code: "XXX", city_name: "Somewhere Else", name: "Other Airport" }] } },
    });
    const provider = new DuffelFlightProvider(new DuffelClient("duffel_test_abc", net.impl), fx);
    expect(await provider.resolveIata("Gaya")).toBe("GAY");
    expect(await provider.resolveIata("gaya")).toBe("GAY");
    expect(net.calls).toHaveLength(1); // second lookup came from the cache
    expect(await provider.resolveIata("Mumbai")).toBe("BOM"); // local list, no request
    await expect(provider.resolveIata("Nowhereville")).rejects.toThrow(/Could not find an airport/);
  });

  it("turns API failures into messages the agent can relay, without leaking the token", async () => {
    const run = (routes: Parameters<typeof fakeFetch>[0]) =>
      new DuffelFlightProvider(new DuffelClient("duffel_test_secret", fakeFetch(routes).impl), fx).searchFlights(flightQuery);
    await expect(run({ "/air/": { status: 401, body: { errors: [{ title: "Unauthorized" }] } } })).rejects.toThrow(/rejected the access token/);
    await expect(run({ "/air/": { status: 422, body: { errors: [{ message: "departure_date must be in the future" }] } } })).rejects.toThrow(/must be in the future/);
    await expect(run({ "/air/": { status: 429, body: {} } })).rejects.toThrow(/rate limiting/);
    await expect(run({ "/air/": { status: 500, body: "oops" } })).rejects.toThrow(/error \(500\)/);
    const network = run({ "/air/": () => { throw new TypeError("fetch failed"); } });
    await expect(network).rejects.toBeInstanceOf(ProviderError);
    await expect(network).rejects.not.toThrow(/secret/);
    await expect(run({})).rejects.toBeInstanceOf(ProviderError);
  });

  it("validates dates before calling the API", async () => {
    const net = fakeFetch({});
    const provider = new DuffelFlightProvider(new DuffelClient("duffel_test_abc", net.impl), fx);
    await expect(provider.searchFlights({ ...flightQuery, returnDate: "2026-12-01" })).rejects.toThrow(/before departDate/);
    expect(net.calls).toHaveLength(0);
  });

  it("parses ISO durations", () => {
    expect(isoDurationToMinutes("PT2H35M")).toBe(155);
    expect(isoDurationToMinutes("P1DT1H5M")).toBe(1505);
    expect(isoDurationToMinutes("PT45M")).toBe(45);
    expect(isoDurationToMinutes(null)).toBe(0);
  });
});

describe("Duffel stays adapter", () => {
  const stayQuery = { city: "Goa", checkIn: "2026-12-18", checkOut: "2026-12-22", guests: 2, currency: "INR" };
  const geocode = async () => ({ lat: 15.5, lng: 73.8, name: "Goa" });

  it("falls back to the mock when Stays is not enabled on the account, and stops asking", async () => {
    const net = fakeFetch({ "/stays/search": { status: 403, body: "This feature is not enabled for your account. Please contact sales to get access: https://duffel.com/contact-us" } });
    const provider = new DuffelStayProvider(new DuffelClient("duffel_test_abc", net.impl), fx, geocode, new MockStayProvider());
    expect(provider.name).toBe("duffel");
    const first = await provider.searchStays(stayQuery);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((o) => o.source === "mock")).toBe(true);
    expect(provider.name).toBe("mock");
    await provider.searchStays(stayQuery);
    expect(net.calls).toHaveLength(1);
  });

  it("maps a documented-shape response into stay offers", async () => {
    const net = fakeFetch({
      "/stays/search": {
        body: {
          data: {
            results: [
              {
                id: "srr_1", check_in_date: "2026-12-18", check_out_date: "2026-12-22", rooms: 1,
                cheapest_rate_total_amount: "400.00", cheapest_rate_currency: "USD",
                accommodation: {
                  name: "Test Hotel", type: "hotel", rating: 4, review_score: 8.8,
                  amenities: [{ type: "wifi", description: "Wi-Fi" }, { type: "pool", description: "Pool" }],
                  location: { geographic_coordinates: { latitude: 15.55, longitude: 73.76 }, address: { line_one: "1 Beach Road", city_name: "Calangute" } },
                },
              },
            ],
          },
        },
      },
    });
    const offers = await new DuffelStayProvider(new DuffelClient("duffel_test_abc", net.impl), fx, geocode, new MockStayProvider()).searchStays(stayQuery);
    expect(net.calls[0].body).toEqual({
      data: {
        rooms: 1, location: { radius: 10, geographic_coordinates: { latitude: 15.5, longitude: 73.8 } },
        check_in_date: "2026-12-18", check_out_date: "2026-12-22", guests: [{ type: "adult" }, { type: "adult" }],
      },
    });
    expect(offers).toEqual([
      expect.objectContaining({
        id: "srr_1", source: "duffel", testMode: true, name: "Test Hotel", city: "Calangute", area: "1 Beach Road", kind: "hotel",
        stars: 4, rating: 8.8, nights: 4, rooms: 1, totalPrice: 37200, pricePerNight: 9300, currency: "INR", amenities: ["Wi-Fi", "Pool"], lat: 15.55, lng: 73.76,
      }),
    ]);
  });
});

describe("exchange rates", () => {
  it("uses the live reference rate, caches it, and falls back to an approximate rate on failure", async () => {
    const net = fakeFetch({ "frankfurter.dev": { body: { date: "2026-11-17", rates: { INR: 93.48 } } } });
    const live = new FrankfurterFxProvider(net.impl);
    expect(await live.quote("USD", "INR")).toEqual({ rate: 93.48, source: "ecb", date: "2026-11-17" });
    await live.quote("usd", "inr");
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].url).toContain("base=USD&symbols=INR");
    expect(await live.quote("INR", "INR")).toEqual({ rate: 1, source: "same" });

    const down = new FrankfurterFxProvider(fakeFetch({ "frankfurter.dev": { status: 503, body: "down" } }).impl);
    const q = await down.quote("USD", "INR");
    expect(q.source).toBe("approximate");
    expect(q.rate).toBeGreaterThan(50);
  });
});

describe("Open-Meteo weather adapter", () => {
  const now = () => new Date("2026-11-18T06:00:00Z");

  it("returns a real forecast for dates inside the forecast window", async () => {
    const net = fakeFetch({
      "api.open-meteo.com/v1/forecast": {
        body: { daily: { time: ["2026-11-20", "2026-11-21"], temperature_2m_max: [33.6, 34.1], temperature_2m_min: [21.4, 22.2], precipitation_probability_max: [2, 60], weather_code: [0, 61] } },
      },
    });
    const w = await new OpenMeteoWeatherProvider(net.impl, now).getWeather("Goa", "2026-11-20", "2026-11-21");
    expect(w).toMatchObject({ source: "open-meteo", kind: "forecast", city: "Goa" });
    expect(w.note).toBeUndefined();
    expect(w.days).toEqual([
      { date: "2026-11-20", minC: 21, maxC: 34, rainChance: 2, summary: "Clear" },
      { date: "2026-11-21", minC: 22, maxC: 34, rainChance: 60, summary: "Rain" },
    ]);
    expect(net.calls[0].url).toContain("start_date=2026-11-20&end_date=2026-11-21");
  });

  it("uses last year's recorded weather, clearly labelled, for dates too far ahead to forecast", async () => {
    const net = fakeFetch({
      "archive-api.open-meteo.com": {
        body: { daily: { time: ["2025-12-18", "2025-12-19"], temperature_2m_max: [32.2, 31.8], temperature_2m_min: [20.6, 21.1], precipitation_sum: [0, 6.5], weather_code: [1, 63] } },
      },
    });
    const w = await new OpenMeteoWeatherProvider(net.impl, now).getWeather("Goa", "2026-12-18", "2026-12-19");
    expect(w.kind).toBe("climate-normal");
    expect(w.note).toContain("same dates in 2025");
    expect(w.note).toContain("not a forecast");
    expect(net.calls[0].url).toContain("start_date=2025-12-18&end_date=2025-12-19");
    // Dates are shown as the trip's dates, values are last year's.
    expect(w.days).toEqual([
      { date: "2026-12-18", minC: 21, maxC: 32, rainChance: 5, summary: "Partly cloudy" },
      { date: "2026-12-19", minC: 21, maxC: 32, rainChance: 80, summary: "Rain" },
    ]);
  });

  it("geocodes places outside the local list and reports unknown places", async () => {
    const net = fakeFetch({
      "name=Gokarna": { body: { results: [{ name: "Gokarna", latitude: 14.55, longitude: 74.32 }] } },
      "name=Zzyzx": { body: {} },
      "api.open-meteo.com/v1/forecast": { body: { daily: { time: ["2026-11-20"], temperature_2m_max: [31], temperature_2m_min: [22], precipitation_probability_max: [10], weather_code: [2] } } },
    });
    const provider = new OpenMeteoWeatherProvider(net.impl, now);
    const w = await provider.getWeather("Gokarna", "2026-11-20", "2026-11-20");
    expect(w.city).toBe("Gokarna");
    expect(net.calls[1].url).toContain("latitude=14.55&longitude=74.32");
    await expect(provider.getWeather("Zzyzx", "2026-11-20", "2026-11-20")).rejects.toThrow(/Could not locate/);
  });

  it("reports an outage as a readable error", async () => {
    const net = fakeFetch({ "open-meteo.com": { status: 500, body: "down" } });
    await expect(new OpenMeteoWeatherProvider(net.impl, now).getWeather("Goa", "2026-11-20", "2026-11-21")).rejects.toThrow(/no data/);
  });
});
