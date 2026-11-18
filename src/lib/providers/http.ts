import { ProviderError } from "./types";

/** `fetch` is injected into every real adapter so tests can replace the network. */
export type Fetch = typeof fetch;

export interface JsonResult {
  status: number;
  ok: boolean;
  body: unknown;
  text: string;
}

/** Fetches a URL and parses JSON, turning network failures and timeouts into ProviderError. */
export async function fetchJson(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number; service: string },
): Promise<JsonResult> {
  const { timeoutMs = 30000, service, ...rest } = init;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ProviderError(timedOut ? `${service} took too long to respond.` : `Could not reach ${service}.`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* some error responses are plain text */
  }
  return { status: res.status, ok: res.ok, body, text };
}
