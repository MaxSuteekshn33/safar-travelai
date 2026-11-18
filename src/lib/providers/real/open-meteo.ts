import type { WeatherDay, WeatherResult } from "@/lib/types";
import { fetchJson, type Fetch } from "../http";
import { findPlace, isIsoDate } from "../mock/places";
import { ProviderError, type WeatherProvider } from "../types";

interface Daily {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
  weather_code?: (number | null)[];
}

// WMO weather codes, grouped.
function describe(code: number | null | undefined, rain: number): string {
  if (code == null) return rain > 55 ? "Likely rain" : "No description";
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

const DAY = 86400000;
const shiftYear = (iso: string, years: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

/** Place name to coordinates using Open-Meteo's geocoder (no key). Shared with stays search. */
export function openMeteoGeocoder(fetchImpl: Fetch = fetch) {
  const cache = new Map<string, { lat: number; lng: number; name: string } | null>();
  return async (city: string) => {
    const local = findPlace(city);
    if (local) return { lat: local.lat, lng: local.lng, name: local.city };
    const key = city.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    const res = await fetchJson(fetchImpl, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1`, {
      service: "the place lookup service",
      timeoutMs: 10000,
    });
    const hit = (res.body as { results?: { name: string; latitude: number; longitude: number }[] } | null)?.results?.[0];
    const out = hit ? { lat: hit.latitude, lng: hit.longitude, name: hit.name } : null;
    cache.set(key, out);
    return out;
  };
}

/**
 * Open-Meteo weather (no key). Dates within the 16-day forecast window get a
 * real forecast. Dates further out get what the weather actually was on the
 * same dates last year, labelled as such, since no forecast exists yet.
 */
export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly name = "open-meteo";
  private geocode: ReturnType<typeof openMeteoGeocoder>;

  constructor(
    private fetchImpl: Fetch = fetch,
    private now: () => Date = () => new Date(),
  ) {
    this.geocode = openMeteoGeocoder(fetchImpl);
  }

  async getWeather(city: string, startDate: string, endDate: string): Promise<WeatherResult> {
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new ProviderError("Dates must be YYYY-MM-DD.");
    if (endDate < startDate) throw new ProviderError("endDate is before startDate.");
    const place = await this.geocode(city);
    if (!place) throw new ProviderError(`Could not locate "${city}" for a weather lookup.`);

    const today = this.now().toISOString().slice(0, 10);
    const lastForecastDay = new Date(Date.parse(`${today}T00:00:00Z`) + 15 * DAY).toISOString().slice(0, 10);
    const end = endDate > new Date(Date.parse(`${startDate}T00:00:00Z`) + 13 * DAY).toISOString().slice(0, 10)
      ? new Date(Date.parse(`${startDate}T00:00:00Z`) + 13 * DAY).toISOString().slice(0, 10)
      : endDate;
    const coords = `latitude=${place.lat}&longitude=${place.lng}&timezone=auto`;

    if (startDate >= today && end <= lastForecastDay) {
      const daily = await this.daily(
        `https://api.open-meteo.com/v1/forecast?${coords}&start_date=${startDate}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`,
      );
      return { source: "open-meteo", city: place.name, kind: "forecast", days: this.toDays(daily, 0) };
    }

    // Too far ahead for a forecast: look at the most recent past year with these dates.
    let back = 0;
    do back -= 1;
    while (shiftYear(end, back) >= today);
    const daily = await this.daily(
      `https://archive-api.open-meteo.com/v1/archive?${coords}&start_date=${shiftYear(startDate, back)}&end_date=${shiftYear(end, back)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code`,
    );
    const year = shiftYear(startDate, back).slice(0, 4);
    return {
      source: "open-meteo",
      city: place.name,
      kind: "climate-normal",
      days: this.toDays(daily, -back),
      note: `No forecast exists this far ahead. These are the recorded conditions on the same dates in ${year}; present them as a guide to what is typical, not a forecast.`,
    };
  }

  private async daily(url: string): Promise<Daily> {
    // The archive endpoint is occasionally slow; one retry covers most timeouts.
    let res;
    try {
      res = await fetchJson(this.fetchImpl, url, { service: "the weather service", timeoutMs: 12000 });
    } catch {
      res = await fetchJson(this.fetchImpl, url, { service: "the weather service", timeoutMs: 20000 });
    }
    const daily = (res.body as { daily?: Daily } | null)?.daily;
    if (!res.ok || !daily?.time?.length) throw new ProviderError("The weather service had no data for those dates.");
    return daily;
  }

  private toDays(d: Daily, yearsForward: number): WeatherDay[] {
    return d.time.flatMap((date, i) => {
      const max = d.temperature_2m_max[i];
      const min = d.temperature_2m_min[i];
      if (max == null || min == null) return [];
      // For past data, turn rainfall in mm into a rough chance so both kinds read the same way.
      const mm = d.precipitation_sum?.[i];
      const rain = d.precipitation_probability_max?.[i] ?? (mm == null ? 0 : mm >= 5 ? 80 : mm >= 1 ? 50 : mm > 0 ? 20 : 5);
      return [
        {
          date: yearsForward ? shiftYear(date, yearsForward) : date,
          minC: Math.round(min),
          maxC: Math.round(max),
          rainChance: Math.round(rain),
          summary: describe(d.weather_code?.[i], rain),
        },
      ];
    });
  }
}
