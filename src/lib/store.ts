import type Anthropic from "@anthropic-ai/sdk";
import { emptyItinerary, type Itinerary, type TravelerProfile } from "@/lib/types";

export type StoredMessage = Anthropic.Beta.BetaMessageParam;
export type OfferKind = "flight" | "stay" | "transfer";

/**
 * Everything the agent loop and tools persist. The Prisma implementation is
 * in ./store-prisma.ts; tests use the in-memory one below.
 */
export interface Store {
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
  getItinerary(conversationId: string): Promise<Itinerary>;
  saveItinerary(conversationId: string, itinerary: Itinerary): Promise<void>;
  saveOffers(conversationId: string, kind: OfferKind, offers: { id: string }[]): Promise<void>;
  getOffers<T>(conversationId: string, kind: OfferKind, ids: string[]): Promise<{ found: T[]; missing: string[] }>;
  getProfile(): Promise<TravelerProfile>;
  saveProfile(profile: TravelerProfile): Promise<void>;
  /** Trips planned in other conversations, newest first, for cross-session memory. */
  listTrips(excludeConversationId: string): Promise<TripSummary[]>;
}

export interface TripSummary {
  title?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
}

export class MemoryStore implements Store {
  messages = new Map<string, StoredMessage[]>();
  itineraries = new Map<string, Itinerary>();
  offers = new Map<string, unknown>();
  profile: TravelerProfile = {};

  async listMessages(id: string) {
    return [...(this.messages.get(id) ?? [])];
  }
  async appendMessage(id: string, message: StoredMessage) {
    this.messages.set(id, [...(this.messages.get(id) ?? []), message]);
  }
  async getItinerary(id: string) {
    return this.itineraries.get(id) ?? emptyItinerary();
  }
  async saveItinerary(id: string, itinerary: Itinerary) {
    this.itineraries.set(id, itinerary);
  }
  async saveOffers(id: string, kind: OfferKind, offers: { id: string }[]) {
    for (const o of offers) this.offers.set(`${id}:${kind}:${o.id}`, o);
  }
  async getOffers<T>(id: string, kind: OfferKind, ids: string[]) {
    const found: T[] = [];
    const missing: string[] = [];
    for (const offerId of ids) {
      const o = this.offers.get(`${id}:${kind}:${offerId}`);
      if (o) found.push(o as T);
      else missing.push(offerId);
    }
    return { found, missing };
  }
  async getProfile() {
    return this.profile;
  }
  async saveProfile(profile: TravelerProfile) {
    this.profile = profile;
  }
  async listTrips(excludeConversationId: string) {
    return [...this.itineraries.entries()]
      .filter(([id, it]) => id !== excludeConversationId && (it.trip.destination || it.trip.title))
      .map(([, it]) => ({ title: it.trip.title, destination: it.trip.destination, startDate: it.trip.startDate, endDate: it.trip.endDate }))
      .reverse();
  }
}
