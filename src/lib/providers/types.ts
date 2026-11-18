import type {
  FlightOffer,
  ResearchResult,
  StayOffer,
  TransferEstimate,
  WeatherResult,
} from "@/lib/types";

// Every external source sits behind one of these interfaces. Each has a mock
// implementation; a real one is selected in ./index.ts when its key is set.

export interface FlightSearch {
  origin: string; // city name or IATA code
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children?: number;
  cabin?: "economy" | "premium_economy" | "business" | "first";
  currency: string;
}

export interface FlightProvider {
  readonly name: string;
  searchFlights(q: FlightSearch): Promise<FlightOffer[]>;
}

export interface StaySearch {
  city: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms?: number;
  maxPricePerNight?: number;
  currency: string;
}

export interface StayProvider {
  readonly name: string;
  searchStays(q: StaySearch): Promise<StayOffer[]>;
}

export interface TransferLeg {
  from: string;
  to: string;
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
}

export interface TransferProvider {
  readonly name: string;
  estimate(city: string, legs: TransferLeg[], currency: string): Promise<TransferEstimate[]>;
}

export interface ResearchQuery {
  destination: string;
  interests?: string[];
  dietary?: string;
  month?: string;
}

export interface ResearchProvider {
  readonly name: string;
  research(q: ResearchQuery): Promise<ResearchResult>;
}

export interface WeatherProvider {
  readonly name: string;
  getWeather(city: string, startDate: string, endDate: string): Promise<WeatherResult>;
}

export interface Providers {
  flights: FlightProvider;
  stays: StayProvider;
  transfers: TransferProvider;
  research: ResearchProvider;
  weather: WeatherProvider;
}

/** Thrown by providers for problems the agent should be told about in plain words. */
export class ProviderError extends Error {}
