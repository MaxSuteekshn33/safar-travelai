import type { FlightOffer, StayOffer } from "@/lib/types";
import { cancellationTerms, changeTerms, describeOffer, makeReference } from "./policy";
import { isFlight, type ActionSummary, type BookPayload, type Booking, type BookingStore, type CancelPayload, type ChangePayload, type PendingAction } from "./types";

/** A problem to tell the traveller about, in plain words. */
export class BookingError extends Error {}

const SIMULATED = "Simulated booking: no real reservation is made and no payment is taken.";

/**
 * Booking lifecycle with a hard confirmation gate. The agent can only
 * *propose* (the propose* methods create a pending action). Nothing changes
 * until `confirm` is called, and that only happens from the app when the
 * traveller presses the button.
 */
export class BookingService {
  constructor(
    private store: BookingStore,
    private now: () => number = Date.now,
    private random: () => number = Math.random,
  ) {}

  private stamp(text: string) {
    return { at: new Date(this.now()).toISOString(), text };
  }

  async list(conversationId?: string): Promise<Booking[]> {
    return this.store.listBookings(conversationId);
  }

  pending(conversationId: string): Promise<PendingAction[]> {
    return this.store.listPendingActions(conversationId);
  }

  async proposeBooking(conversationId: string, flights: FlightOffer[], stays: StayOffer[], travellers: string[]): Promise<PendingAction> {
    if (flights.length + stays.length === 0) throw new BookingError("Nothing was selected to book.");
    const names = travellers.map((t) => t.trim()).filter(Boolean);
    if (names.length === 0) throw new BookingError("Traveller names are needed before booking. Ask for the name of each traveller as on their ID.");
    for (const f of flights) {
      if (f.travellers !== names.length) throw new BookingError(`The flight was priced for ${f.travellers} traveller(s) but ${names.length} name(s) were given.`);
    }
    const items = [...flights, ...stays];
    const currency = items[0].currency;
    if (items.some((i) => i.currency !== currency)) throw new BookingError("The selected items are priced in different currencies; book them separately.");
    const amount = items.reduce((n, i) => n + i.totalPrice, 0);
    // A stand-in booking, only to word the fare rules on the card the same way they will apply later.
    const draft: Booking = { id: "", reference: "", conversationId, kind: "flight", status: "confirmed", title: "", travellers: names, totalPrice: 0, currency, offer: items[0], simulated: true, events: [], createdAt: "" };
    const summary: ActionSummary = {
      title: items.length === 1 ? "Confirm this booking" : `Confirm these ${items.length} bookings`,
      lines: [...items.map((i) => `${describeOffer(i)}: ${currency} ${i.totalPrice.toLocaleString("en-IN")}`), `Travellers: ${names.join(", ")}`],
      amount,
      currency,
      terms: [
        SIMULATED,
        ...flights.map((f) => `Flight: ${cancellationTerms({ ...draft, offer: f, totalPrice: f.totalPrice, kind: "flight" }, this.now()).explanation}`),
        ...(stays.length ? ["Stay: free cancellation until 48 hours before check-in."] : []),
      ],
      confirmLabel: "Confirm booking",
    };
    const payload: BookPayload = { travellers: names, flights, stays };
    return this.store.createAction({ conversationId, type: "book", summary, payload });
  }

  private async mustFind(reference: string): Promise<Booking> {
    const b = await this.store.findByReference(reference.trim().toUpperCase());
    if (!b) throw new BookingError(`No booking with reference ${reference} was found.`);
    return b;
  }

  async proposeCancellation(conversationId: string, reference: string): Promise<PendingAction> {
    const b = await this.mustFind(reference);
    const terms = cancellationTerms(b, this.now());
    if (!terms.allowed) throw new BookingError(terms.explanation);
    const summary: ActionSummary = {
      title: `Cancel booking ${b.reference}?`,
      lines: [b.title, `Paid: ${b.currency} ${b.totalPrice.toLocaleString("en-IN")}`, `Refund: ${b.currency} ${terms.refund.toLocaleString("en-IN")}`],
      amount: -terms.refund,
      currency: b.currency,
      terms: [terms.explanation, "Cancelling cannot be undone.", SIMULATED],
      confirmLabel: "Cancel this booking",
    };
    const payload: CancelPayload = { bookingId: b.id, refundAmount: terms.refund };
    return this.store.createAction({ conversationId, type: "cancel", summary, payload });
  }

  async proposeChange(conversationId: string, reference: string, newOffer: FlightOffer | StayOffer): Promise<PendingAction> {
    const b = await this.mustFind(reference);
    if (isFlight(newOffer) !== (b.kind === "flight")) throw new BookingError(`Booking ${b.reference} is a ${b.kind}; it can only be changed to another ${b.kind}.`);
    if (newOffer.currency !== b.currency) throw new BookingError("The replacement is priced in a different currency.");
    if (isFlight(newOffer) && newOffer.travellers !== b.travellers.length) throw new BookingError(`The replacement flight is priced for ${newOffer.travellers} traveller(s), but the booking has ${b.travellers.length}.`);
    const terms = changeTerms(b, this.now());
    if (!terms.allowed) throw new BookingError(terms.explanation);
    const difference = newOffer.totalPrice - b.totalPrice;
    const amount = terms.fee + difference;
    const money = (n: number) => `${b.currency} ${Math.abs(n).toLocaleString("en-IN")}`;
    const summary: ActionSummary = {
      title: `Change booking ${b.reference}?`,
      lines: [
        `From: ${b.title}`,
        `To: ${describeOffer(newOffer)}`,
        `Price difference: ${difference >= 0 ? "+" : "-"}${money(difference)}`,
        `Change fee: ${money(terms.fee)}`,
        amount >= 0 ? `You pay: ${money(amount)}` : `You get back: ${money(amount)}`,
      ],
      amount,
      currency: b.currency,
      terms: [terms.explanation, SIMULATED],
      confirmLabel: "Confirm change",
    };
    const payload: ChangePayload = { bookingId: b.id, newOffer, fee: terms.fee, difference };
    return this.store.createAction({ conversationId, type: "change", summary, payload });
  }

  async decline(actionId: string): Promise<PendingAction> {
    const action = await this.store.getAction(actionId);
    if (!action) throw new BookingError("That request no longer exists.");
    if (action.status === "pending") await this.store.setActionStatus(actionId, "declined");
    return { ...action, status: action.status === "pending" ? "declined" : action.status };
  }

  /** Carries out a pending action. Called only from the app when the traveller confirms. */
  async confirm(actionId: string): Promise<{ action: PendingAction; bookings: Booking[]; message: string }> {
    const action = await this.store.getAction(actionId);
    if (!action) throw new BookingError("That request no longer exists.");
    if (action.status !== "pending") throw new BookingError(`That request was already ${action.status}.`);
    // Mark first so a double click cannot run it twice.
    await this.store.setActionStatus(actionId, "confirmed");

    if (action.type === "book") {
      const p = action.payload as BookPayload;
      const out: Booking[] = [];
      for (const offer of [...p.flights, ...p.stays]) {
        out.push(
          await this.store.createBooking({
            reference: await this.freshReference(),
            conversationId: action.conversationId,
            kind: isFlight(offer) ? "flight" : "stay",
            status: "confirmed",
            title: describeOffer(offer),
            travellers: p.travellers,
            totalPrice: offer.totalPrice,
            currency: offer.currency,
            offer,
            simulated: true,
            events: [this.stamp("Booked (simulated).")],
          }),
        );
      }
      return { action, bookings: out, message: `Booked. ${out.map((b) => `${b.kind === "flight" ? "Flight" : "Stay"} reference ${b.reference}`).join(", ")}.` };
    }

    if (action.type === "cancel") {
      const p = action.payload as CancelPayload;
      const b = await this.store.getBooking(p.bookingId);
      if (!b) throw new BookingError("That booking no longer exists.");
      const terms = cancellationTerms(b, this.now());
      if (!terms.allowed) throw new BookingError(terms.explanation);
      const updated = await this.store.updateBooking(b.id, {
        status: "cancelled",
        refundAmount: terms.refund,
        disruption: undefined,
        events: [...b.events, this.stamp(`Cancelled. Refund ${b.currency} ${terms.refund.toLocaleString("en-IN")} (simulated).`)],
      });
      return { action, bookings: [updated], message: `Booking ${b.reference} is cancelled. Refund: ${b.currency} ${terms.refund.toLocaleString("en-IN")}.` };
    }

    const p = action.payload as ChangePayload;
    const b = await this.store.getBooking(p.bookingId);
    if (!b) throw new BookingError("That booking no longer exists.");
    const terms = changeTerms(b, this.now());
    if (!terms.allowed) throw new BookingError(terms.explanation);
    const updated = await this.store.updateBooking(b.id, {
      status: "confirmed",
      disruption: undefined,
      offer: p.newOffer,
      title: describeOffer(p.newOffer),
      totalPrice: p.newOffer.totalPrice,
      events: [...b.events, this.stamp(`Changed to ${describeOffer(p.newOffer)}. Fee ${b.currency} ${terms.fee.toLocaleString("en-IN")} (simulated).`)],
    });
    return { action, bookings: [updated], message: `Booking ${b.reference} is changed to ${updated.title}.` };
  }

  /** Demo aid: pretend the airline or property disrupted a booking. */
  async disrupt(bookingId: string): Promise<Booking> {
    const b = await this.store.getBooking(bookingId);
    if (!b) throw new BookingError("That booking no longer exists.");
    if (b.status !== "confirmed") throw new BookingError("Only a confirmed booking can be disrupted.");
    const disruption = b.kind === "flight" ? "The airline cancelled this flight. You can rebook with no change fee or cancel for a full refund." : "The property can no longer host this stay. You can move to another stay with no fee or cancel for a full refund.";
    return this.store.updateBooking(b.id, { status: "disrupted", disruption, events: [...b.events, this.stamp(`Disruption (simulated): ${disruption}`)] });
  }

  private async freshReference(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const ref = makeReference(this.random);
      if (!(await this.store.findByReference(ref))) return ref;
    }
    throw new BookingError("Could not create a booking reference. Try again.");
  }
}

/** In-memory store for tests. */
export class MemoryBookingStore implements BookingStore {
  bookings: Booking[] = [];
  actions: PendingAction[] = [];
  private n = 0;
  constructor(private now: () => number = Date.now) {}

  async createBooking(b: Omit<Booking, "id" | "createdAt">) {
    const created: Booking = { ...b, id: `b${++this.n}`, createdAt: new Date(this.now()).toISOString() };
    this.bookings.push(created);
    return created;
  }
  async updateBooking(id: string, patch: Partial<Booking>) {
    const i = this.bookings.findIndex((b) => b.id === id);
    this.bookings[i] = { ...this.bookings[i], ...patch };
    return this.bookings[i];
  }
  async getBooking(id: string) {
    return this.bookings.find((b) => b.id === id) ?? null;
  }
  async findByReference(reference: string) {
    return this.bookings.find((b) => b.reference === reference) ?? null;
  }
  async listBookings(conversationId?: string) {
    return this.bookings.filter((b) => !conversationId || b.conversationId === conversationId);
  }
  async createAction(a: Omit<PendingAction, "id" | "createdAt" | "status">) {
    const created: PendingAction = { ...a, id: `a${++this.n}`, status: "pending", createdAt: new Date(this.now()).toISOString() };
    this.actions.push(created);
    return created;
  }
  async getAction(id: string) {
    return this.actions.find((a) => a.id === id) ?? null;
  }
  async setActionStatus(id: string, status: PendingAction["status"]) {
    const a = this.actions.find((x) => x.id === id);
    if (a) a.status = status;
  }
  async listPendingActions(conversationId: string) {
    return this.actions.filter((a) => a.conversationId === conversationId && a.status === "pending");
  }
}
