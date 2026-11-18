import { fetchJson, type Fetch } from "./http";

export interface FxQuote {
  rate: number; // 1 unit of `from` in `to`
  /** "ecb" when fetched from the live reference-rate service, "approximate" for the built-in table. */
  source: "ecb" | "approximate" | "same";
  date?: string;
}

export interface FxProvider {
  readonly name: string;
  quote(from: string, to: string): Promise<FxQuote>;
}

// Rough INR value of one unit of each currency. Used offline and as a fallback.
const INR_PER: Record<string, number> = { INR: 1, USD: 93, EUR: 102, GBP: 123, AED: 25.3, SGD: 71, THB: 2.8, JPY: 0.6 };

export class StaticFxProvider implements FxProvider {
  readonly name = "mock";
  async quote(from: string, to: string): Promise<FxQuote> {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return { rate: 1, source: "same" };
    const a = INR_PER[f];
    const b = INR_PER[t];
    if (!a || !b) return { rate: 1, source: "approximate" };
    return { rate: a / b, source: "approximate" };
  }
}

/** Daily reference rates from frankfurter.dev (European Central Bank data, no key). */
export class FrankfurterFxProvider implements FxProvider {
  readonly name = "frankfurter";
  private cache = new Map<string, { at: number; quote: FxQuote }>();
  private fallback = new StaticFxProvider();

  constructor(
    private fetchImpl: Fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  async quote(from: string, to: string): Promise<FxQuote> {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return { rate: 1, source: "same" };
    const key = `${f}-${t}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < 6 * 3600_000) return hit.quote;
    try {
      const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(f)}&symbols=${encodeURIComponent(t)}`;
      const res = await fetchJson(this.fetchImpl, url, { service: "the exchange-rate service", timeoutMs: 8000 });
      const body = res.body as { date?: string; rates?: Record<string, number> } | null;
      const rate = body?.rates?.[t];
      if (!res.ok || typeof rate !== "number" || !(rate > 0)) throw new Error("no rate");
      const quote: FxQuote = { rate, source: "ecb", date: body?.date };
      this.cache.set(key, { at: this.now(), quote });
      return quote;
    } catch {
      // A price in roughly the right currency beats no price; the caller labels it approximate.
      return this.fallback.quote(f, t);
    }
  }
}

/** Rounds a converted amount the way people quote it: nearest 10 for INR-sized numbers, else whole units. */
export function roundMoney(amount: number, currency: string): number {
  return ["INR", "JPY", "THB"].includes(currency.toUpperCase()) ? Math.round(amount / 10) * 10 : Math.round(amount);
}
