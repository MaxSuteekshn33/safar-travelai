import { fetchJson, type Fetch } from "../http";
import { ProviderError } from "../types";

const BASE = "https://api.duffel.com";

/** Raised when the account does not have a Duffel product (e.g. Stays) switched on. */
export class DuffelFeatureUnavailable extends ProviderError {}

/** Minimal Duffel REST client (API version v2). */
export class DuffelClient {
  constructor(
    private token: string,
    private fetchImpl: Fetch = fetch,
  ) {}

  /** Test tokens start with duffel_test_; their results are fictional. */
  get testMode(): boolean {
    return this.token.startsWith("duffel_test_");
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 40000): Promise<T> {
    const res = await fetchJson(this.fetchImpl, `${BASE}${path}`, {
      method,
      service: "Duffel",
      timeoutMs,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify({ data: body }) : undefined,
    });
    if (res.ok) return (res.body as { data: T }).data;

    const first = (res.body as { errors?: { title?: string; message?: string; code?: string }[] } | null)?.errors?.[0];
    const detail = first?.message ?? first?.title ?? res.text.slice(0, 200);
    if (res.status === 401) throw new ProviderError("Duffel rejected the access token. Check DUFFEL_ACCESS_TOKEN.");
    if (res.status === 403 && /not enabled|contact sales/i.test(res.text)) {
      throw new DuffelFeatureUnavailable("This Duffel feature is not enabled for the account.");
    }
    if (res.status === 429) throw new ProviderError("Duffel is rate limiting requests. Try again in a minute.");
    if (res.status === 422 || res.status === 400) throw new ProviderError(`Duffel could not run that search: ${detail}`);
    throw new ProviderError(`Duffel returned an error (${res.status}).`);
  }
}
