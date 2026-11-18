// Domain types shared by providers, the agent tools, the API and the UI.

export type DataSource = "mock" | "duffel" | "open-meteo" | "web" | "estimate";

export interface FlightSegment {
  carrier: string;
  flightNumber: string;
  from: string; // IATA
  to: string; // IATA
  departAt: string; // local ISO, no zone
  arriveAt: string;
}

export interface FlightOffer {
  id: string;
  source: DataSource;
  /** True for offers from a provider's test mode: real API, fictional data. */
  testMode?: boolean;
  /** When the provider stops honouring this offer, if it says. */
  expiresAt?: string;
  origin: string;
  destination: string;
  outbound: FlightSegment[];
  inbound?: FlightSegment[];
  stops: number;
  durationMinutes: number; // outbound journey
  cabin: string;
  baggage: string;
  travellers: number;
  totalPrice: number; // for all travellers
  currency: string;
  /** Fare rules from the provider, with fees already in `currency`. Absent for sample data. */
  conditions?: { refundable: boolean; refundFee: number; changeable: boolean; changeFee: number };
  notes?: string[];
}

export interface StayOffer {
  id: string;
  source: DataSource;
  testMode?: boolean;
  name: string;
  city: string;
  area: string;
  kind: "hotel" | "resort" | "homestay" | "hostel" | "apartment";
  stars: number;
  rating: number; // out of 10
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  pricePerNight: number;
  totalPrice: number;
  currency: string;
  amenities: string[];
  lat?: number;
  lng?: number;
  notes?: string[];
}

export interface TransferEstimate {
  id: string;
  source: DataSource; // always an estimate, never a quote
  from: string;
  to: string;
  distanceKm: number;
  durationMinutes: number;
  mode: "cab" | "auto" | "metro" | "bus" | "walk";
  cost: number;
  currency: string;
  isEstimate: true;
}

export interface Recommendation {
  name: string;
  category: "sight" | "food" | "experience" | "area" | "tip";
  summary: string;
  sourceTitle?: string;
  sourceUrl?: string;
  verified: boolean;
  lat?: number;
  lng?: number;
}

export interface ResearchResult {
  source: DataSource;
  destination: string;
  recommendations: Recommendation[];
  note?: string;
}

export interface WeatherDay {
  date: string;
  minC: number;
  maxC: number;
  rainChance: number; // 0..100
  summary: string;
}

export interface WeatherResult {
  source: DataSource;
  city: string;
  kind: "forecast" | "climate-normal";
  days: WeatherDay[];
  note?: string;
}

export interface BookingLink {
  site: string;
  kind: "flights" | "stays";
  url: string;
  verified: boolean; // has this URL pattern been checked to open the right search?
}

// ---------- Itinerary ----------

export interface ItineraryItem {
  time?: string; // "09:30" or "morning"
  title: string;
  kind: "sight" | "food" | "transfer" | "flight" | "stay" | "experience" | "free";
  note?: string;
  cost?: number; // for the whole party, trip currency
  costIsEstimate?: boolean;
  lat?: number;
  lng?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  unverified?: boolean;
}

export interface ItineraryDay {
  day: number;
  date?: string;
  title: string;
  items: ItineraryItem[];
}

export interface TripMeta {
  title?: string;
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  travellers?: number;
  currency?: string;
  budgetTotal?: number;
}

export interface CostLine {
  label: string;
  amount: number;
  isEstimate?: boolean;
}

export interface Itinerary {
  trip: TripMeta;
  flights: FlightOffer[];
  stays: StayOffer[];
  transfers: TransferEstimate[];
  days: ItineraryDay[];
  otherCosts: CostLine[];
  bookingLinks: BookingLink[];
}

export interface BudgetSummary {
  currency: string;
  lines: { label: string; amount: number; isEstimate: boolean }[];
  total: number;
  budgetTotal?: number;
  remaining?: number;
}

export function emptyItinerary(): Itinerary {
  return { trip: {}, flights: [], stays: [], transfers: [], days: [], otherCosts: [], bookingLinks: [] };
}

// ---------- Traveler profile ----------

export interface PastTrip {
  destination: string;
  when?: string;
  note?: string;
}

export interface TravelerProfile {
  name?: string;
  homeCity?: string;
  budgetStyle?: "shoestring" | "value" | "comfort" | "luxury";
  dietary?: string;
  pace?: "relaxed" | "balanced" | "packed";
  airlineLikes?: string[];
  hotelLikes?: string[];
  interests?: string[];
  notes?: string[];
  pastTrips?: PastTrip[];
}

// ---------- Streaming events sent to the browser ----------

export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean; mock: boolean }
  | { type: "itinerary"; itinerary: Itinerary; budget: BudgetSummary }
  | { type: "profile"; profile: TravelerProfile }
  /** The agent proposed a booking, cancellation or change; the traveller must confirm it in the app. */
  | { type: "confirm"; action: import("@/lib/bookings/types").PendingAction }
  | { type: "error"; message: string }
  /** Something the traveller should know that is not an error in this reply. */
  | { type: "notice"; message: string }
  | { type: "done"; stopReason: string | null };
