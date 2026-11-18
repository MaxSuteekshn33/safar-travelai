import { DuffelClient } from "./duffel/client";
import { DuffelFlightProvider } from "./duffel/flights";
import { DuffelStayProvider } from "./duffel/stays";
import { FrankfurterFxProvider, StaticFxProvider } from "./fx";
import type { Fetch } from "./http";
import { MockFlightProvider } from "./mock/flights";
import { MockResearchProvider } from "./mock/research";
import { MockStayProvider } from "./mock/stays";
import { EstimateTransferProvider } from "./mock/transfers";
import { MockWeatherProvider } from "./mock/weather";
import { OpenMeteoWeatherProvider, openMeteoGeocoder } from "./real/open-meteo";
import { WebResearchProvider, type ResearchRunner } from "./real/web-research";
import type { Providers } from "./types";

/**
 * Picks an implementation for each source from the environment.
 *
 * - DUFFEL_ACCESS_TOKEN set: flights and stays come from Duffel. If Stays is
 *   not enabled on the account, stays fall back to the mock at first use.
 * - Weather and exchange rates use free services that need no key, so they
 *   are on by default. SAFAR_OFFLINE=1 forces every source to its mock.
 * - Research reads the live web through the Anthropic API when a research
 *   runner is supplied (ANTHROPIC_API_KEY present); otherwise offline notes.
 * - Transfers are always estimates.
 */
export function buildProviders(env: NodeJS.ProcessEnv = process.env, fetchImpl: Fetch = fetch, researchRunner?: ResearchRunner): Providers {
  const offline = env.SAFAR_OFFLINE === "1";
  const token = offline ? undefined : env.DUFFEL_ACCESS_TOKEN?.trim();
  const fx = offline ? new StaticFxProvider() : new FrankfurterFxProvider(fetchImpl);
  const mockStays = new MockStayProvider();
  const duffel = token ? new DuffelClient(token, fetchImpl) : undefined;

  return {
    flights: duffel ? new DuffelFlightProvider(duffel, fx) : new MockFlightProvider(),
    stays: duffel ? new DuffelStayProvider(duffel, fx, openMeteoGeocoder(fetchImpl), mockStays) : mockStays,
    transfers: new EstimateTransferProvider(),
    research: researchRunner && !offline && env.SAFAR_RESEARCH !== "mock" ? new WebResearchProvider(researchRunner, new MockResearchProvider()) : new MockResearchProvider(),
    weather: offline ? new MockWeatherProvider() : new OpenMeteoWeatherProvider(fetchImpl),
  };
}

// One set per server process, so caches and the "Stays not enabled" finding persist between requests.
const globalForProviders = globalThis as unknown as { safarProviders?: { key: string; providers: Providers } };

let defaultResearchRunner: ResearchRunner | undefined;
/** The server registers the Anthropic-backed runner here; tests leave it unset. */
export function setResearchRunner(runner: ResearchRunner) {
  defaultResearchRunner = runner;
}

export function getProviders(env: NodeJS.ProcessEnv = process.env): Providers {
  if (env !== process.env) return buildProviders(env);
  const hasModel = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) && !!defaultResearchRunner;
  const key = `${env.DUFFEL_ACCESS_TOKEN ?? ""}|${env.SAFAR_OFFLINE ?? ""}|${env.SAFAR_RESEARCH ?? ""}|${hasModel}`;
  if (globalForProviders.safarProviders?.key !== key) {
    globalForProviders.safarProviders = { key, providers: buildProviders(env, fetch, hasModel ? defaultResearchRunner : undefined) };
  }
  return globalForProviders.safarProviders.providers;
}

/** Which implementation each source is using right now, for the UI and README. */
export function providerStatus(env: NodeJS.ProcessEnv = process.env) {
  const p = getProviders(env);
  return {
    flights: p.flights.name,
    stays: p.stays.name,
    transfers: p.transfers.name,
    research: p.research.name,
    weather: p.weather.name,
  };
}
