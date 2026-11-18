import type { WeatherDay, WeatherResult } from "@/lib/types";
import { ProviderError, type WeatherProvider } from "../types";
import { findPlace, isIsoDate, seeded } from "./places";

/** Rough seasonal guess from latitude and month. Not a forecast. */
export class MockWeatherProvider implements WeatherProvider {
  readonly name = "mock";

  async getWeather(city: string, startDate: string, endDate: string): Promise<WeatherResult> {
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new ProviderError("Dates must be YYYY-MM-DD.");
    if (endDate < startDate) throw new ProviderError("endDate is before startDate.");
    const place = findPlace(city);
    const lat = place?.lat ?? 20;
    const rand = seeded(`${city}-${startDate}`);
    const days: WeatherDay[] = [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    for (let d = new Date(start); d <= end && days.length < 14; d.setUTCDate(d.getUTCDate() + 1)) {
      const month = d.getUTCMonth(); // 0..11
      // Seasonal swing grows with distance from the equator; flipped in the south.
      const season = Math.cos(((month - 6) / 12) * 2 * Math.PI) * (lat >= 0 ? 1 : -1);
      // The tropics barely change through the year; the swing starts beyond about 10 degrees.
      const swing = Math.min(14, Math.max(0, Math.abs(lat) - 10) * 0.45);
      const mean = 32 - Math.abs(lat) * 0.3 + season * swing;
      const monsoon = lat > 5 && lat < 30 && month >= 5 && month <= 8;
      const rain = Math.round(Math.min(95, (monsoon ? 60 : 12) + rand() * 25));
      const max = Math.round(mean + 4 + rand() * 2);
      days.push({
        date: d.toISOString().slice(0, 10),
        minC: Math.round(mean - 5 + rand() * 2),
        maxC: max,
        rainChance: rain,
        summary: rain > 55 ? "Likely rain" : max >= 35 ? "Hot and dry" : max <= 12 ? "Cold" : "Mostly clear",
      });
    }
    return {
      source: "mock",
      city: place?.city ?? city,
      kind: "climate-normal",
      days,
      note: "Rough seasonal guess from the mock provider, not a forecast. Describe it as typical for the season.",
    };
  }
}
