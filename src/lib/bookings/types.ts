import type { FlightOffer, StayOffer } from "@/lib/types";

export type BookingKind = "flight" | "stay";
export type BookingStatus = "confirmed" | "cancelled" | "disrupted";

export interface BookingEvent {
  at: string; // ISO time
  text: string;
}

export interface Booking {
  id: string;
  /** Six-character reference shown to the traveller, like an airline PNR. */
  reference: string;
  conversationId: string | null;
  kind: BookingKind;
  status: BookingStatus;
  title: string;
  travellers: string[];
  totalPrice: number;
  currency: string;
  offer: FlightOffer | StayOffer;
  /** Always true in this version: nothing is reserved or charged anywhere. */
  simulated: true;
  events: BookingEvent[];
  refundAmount?: number;
  /** Set when the (simulated) airline or property disrupts the booking. */
  disruption?: string;
  createdAt: string;
}

export type ActionType = "book" | "cancel" | "change";

/** What the traveller sees on the confirmation card. */
export interface ActionSummary {
  title: string;
  lines: string[];
  /** Amount charged (positive) or refunded (negative), in `currency`. */
  amount: number;
  currency: string;
  terms: string[];
  confirmLabel: string;
}

export interface PendingAction {
  id: string;
  conversationId: string;
  type: ActionType;
  status: "pending" | "confirmed" | "declined";
  summary: ActionSummary;
  payload: BookPayload | CancelPayload | ChangePayload;
  createdAt: string;
}

export interface BookPayload {
  travellers: string[];
  flights: FlightOffer[];
  stays: StayOffer[];
}
export interface CancelPayload {
  bookingId: string;
  refundAmount: number;
}
export interface ChangePayload {
  bookingId: string;
  newOffer: FlightOffer | StayOffer;
  fee: number;
  difference: number;
}

/** Storage for bookings; Prisma in the app, in-memory in tests. */
export interface BookingStore {
  createBooking(b: Omit<Booking, "id" | "createdAt">): Promise<Booking>;
  updateBooking(id: string, patch: Partial<Booking>): Promise<Booking>;
  getBooking(id: string): Promise<Booking | null>;
  findByReference(reference: string): Promise<Booking | null>;
  listBookings(conversationId?: string): Promise<Booking[]>;
  createAction(a: Omit<PendingAction, "id" | "createdAt" | "status">): Promise<PendingAction>;
  getAction(id: string): Promise<PendingAction | null>;
  setActionStatus(id: string, status: PendingAction["status"]): Promise<void>;
  listPendingActions(conversationId: string): Promise<PendingAction[]>;
}

export function isFlight(o: FlightOffer | StayOffer): o is FlightOffer {
  return "outbound" in o;
}
