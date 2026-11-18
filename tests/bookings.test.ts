import { describe, expect, it } from "vitest";
import { runAgentTurn, type ModelClient, type ModelRequest, type ModelTurn } from "@/lib/agent/loop";
import { cancellationTerms, changeTerms, makeReference } from "@/lib/bookings/policy";
import { BookingError, BookingService, MemoryBookingStore } from "@/lib/bookings/service";
import { getProviders } from "@/lib/providers";
import { MemoryStore } from "@/lib/store";
import type { ChatEvent, FlightOffer, StayOffer } from "@/lib/types";

const OFFLINE = { SAFAR_OFFLINE: "1" } as unknown as NodeJS.ProcessEnv;
const NOW = Date.parse("2026-11-18T06:00:00Z");
const providers = getProviders(OFFLINE);

async function offers() {
  const flights = await providers.flights.searchFlights({ origin: "Delhi", destination: "Goa", departDate: "2026-12-18", returnDate: "2026-12-22", adults: 2, currency: "INR" });
  const stays = await providers.stays.searchStays({ city: "Goa", checkIn: "2026-12-18", checkOut: "2026-12-22", guests: 2, currency: "INR" });
  return { flight: flights[0], otherFlight: flights[1], stay: stays[0], otherStay: stays[2] };
}

function setup(now = NOW) {
  const clock = { now };
  const store = new MemoryBookingStore(() => clock.now);
  const service = new BookingService(store, () => clock.now);
  return { clock, store, service };
}

describe("booking confirmation gate", () => {
  it("creates nothing until the traveller confirms, then issues one booking per item", async () => {
    const { service, store } = setup();
    const { flight, stay } = await offers();
    const action = await service.proposeBooking("c1", [flight], [stay], ["Asha Rao", "Vikram Rao"]);

    expect(action.status).toBe("pending");
    expect(store.bookings).toHaveLength(0);
    expect(action.summary.amount).toBe(flight.totalPrice + stay.totalPrice);
    expect(action.summary.terms[0]).toContain("no real reservation");
    expect(action.summary.lines.at(-1)).toBe("Travellers: Asha Rao, Vikram Rao");

    const done = await service.confirm(action.id);
    expect(done.bookings.map((b) => [b.kind, b.status, b.simulated])).toEqual([["flight", "confirmed", true], ["stay", "confirmed", true]]);
    expect(done.bookings[0].reference).toMatch(/^[A-Z2-9]{6}$/);
    expect(done.bookings[0].reference).not.toBe(done.bookings[1].reference);
    expect(done.message).toContain(done.bookings[0].reference);
  });

  it("cannot be confirmed twice, and a declined request does nothing", async () => {
    const { service, store } = setup();
    const { flight } = await offers();
    const a = await service.proposeBooking("c1", [flight], [], ["A", "B"]);
    await service.confirm(a.id);
    await expect(service.confirm(a.id)).rejects.toThrow(/already confirmed/);
    expect(store.bookings).toHaveLength(1);

    const b = await service.proposeBooking("c1", [flight], [], ["A", "B"]);
    await service.decline(b.id);
    await expect(service.confirm(b.id)).rejects.toThrow(/already declined/);
    expect(store.bookings).toHaveLength(1);
    await expect(service.confirm("nope")).rejects.toBeInstanceOf(BookingError);
  });

  it("refuses to prepare a booking without names or with the wrong number of travellers", async () => {
    const { service } = setup();
    const { flight } = await offers();
    await expect(service.proposeBooking("c1", [flight], [], [" "])).rejects.toThrow(/names are needed/);
    await expect(service.proposeBooking("c1", [flight], [], ["Only One"])).rejects.toThrow(/priced for 2/);
    await expect(service.proposeBooking("c1", [], [], ["A"])).rejects.toThrow(/Nothing was selected/);
  });
});

describe("cancelling and changing", () => {
  async function booked() {
    const t = setup();
    const o = await offers();
    const { bookings } = await t.service.confirm((await t.service.proposeBooking("c1", [o.flight], [o.stay], ["A", "B"])).id);
    return { ...t, ...o, flightBooking: bookings[0], stayBooking: bookings[1] };
  }

  it("shows the refund before cancelling and applies it only on confirm", async () => {
    const t = await booked();
    const action = await t.service.proposeCancellation("c1", t.flightBooking.reference.toLowerCase());
    const fee = Math.round((t.flight.totalPrice * 0.15) / 10) * 10;
    expect(action.summary.amount).toBe(-(t.flight.totalPrice - fee));
    expect(action.summary.terms.join(" ")).toContain("cannot be undone");
    expect((await t.service.list())[0].status).toBe("confirmed");

    const done = await t.service.confirm(action.id);
    expect(done.bookings[0]).toMatchObject({ status: "cancelled", refundAmount: t.flight.totalPrice - fee });
    await expect(t.service.proposeCancellation("c1", t.flightBooking.reference)).rejects.toThrow(/already cancelled/);
    await expect(t.service.proposeCancellation("c1", "ZZZZZZ")).rejects.toThrow(/No booking/);
  });

  it("applies the stay rules: free until 48 hours before check-in, then one night", async () => {
    const t = await booked();
    expect(cancellationTerms(t.stayBooking, NOW)).toMatchObject({ allowed: true, refund: t.stay.totalPrice, fee: 0 });
    const dayBefore = Date.parse("2026-12-17T14:00:00Z");
    expect(cancellationTerms(t.stayBooking, dayBefore)).toMatchObject({ allowed: true, fee: t.stay.pricePerNight * t.stay.rooms });
    expect(changeTerms(t.stayBooking, dayBefore).allowed).toBe(false);
    expect(cancellationTerms(t.stayBooking, Date.parse("2026-12-19T00:00:00Z")).allowed).toBe(false);
  });

  it("respects non-refundable and no-change fares", async () => {
    const t = setup();
    const { flight } = await offers();
    const strict: FlightOffer = { ...flight, notes: ["Not refundable.", "Changes not allowed."] };
    const [b] = (await t.service.confirm((await t.service.proposeBooking("c1", [strict], [], ["A", "B"])).id)).bookings;
    expect(cancellationTerms(b, NOW)).toMatchObject({ allowed: true, refund: 0 });
    expect(changeTerms(b, NOW).allowed).toBe(false);
    await expect(t.service.proposeChange("c1", b.reference, flight)).rejects.toThrow(/does not allow changes/);
  });

  it("changes a booking to another offer with the fee and fare difference, on confirm only", async () => {
    const t = await booked();
    const action = await t.service.proposeChange("c1", t.flightBooking.reference, t.otherFlight);
    const fee = Math.round((t.flight.totalPrice * 0.1) / 10) * 10;
    expect(action.summary.amount).toBe(fee + (t.otherFlight.totalPrice - t.flight.totalPrice));
    expect((await t.service.list())[0].offer.id).toBe(t.flight.id);
    const done = await t.service.confirm(action.id);
    expect(done.bookings[0]).toMatchObject({ status: "confirmed", totalPrice: t.otherFlight.totalPrice, reference: t.flightBooking.reference });
    expect(done.bookings[0].offer.id).toBe(t.otherFlight.id);
    expect(done.bookings[0].events).toHaveLength(2);
    // A flight cannot be swapped for a stay.
    await expect(t.service.proposeChange("c1", t.flightBooking.reference, t.stay as StayOffer)).rejects.toThrow(/only be changed to another flight/);
  });

  it("waives fees after a disruption: free rebooking or a full refund", async () => {
    const t = await booked();
    const disrupted = await t.service.disrupt(t.flightBooking.id);
    expect(disrupted.status).toBe("disrupted");
    expect(disrupted.disruption).toContain("airline cancelled");
    expect(cancellationTerms(disrupted, NOW)).toMatchObject({ refund: t.flight.totalPrice, fee: 0 });
    const change = await t.service.proposeChange("c1", disrupted.reference, t.otherFlight);
    expect(change.summary.amount).toBe(t.otherFlight.totalPrice - t.flight.totalPrice);
    const done = await t.service.confirm(change.id);
    expect(done.bookings[0]).toMatchObject({ status: "confirmed", disruption: undefined });
    await expect(t.service.disrupt("missing")).rejects.toBeInstanceOf(BookingError);
  });

  it("uses the provider's own fare rules when the offer carries them", async () => {
    const t = setup();
    const { flight } = await offers();
    const withRules: FlightOffer = { ...flight, conditions: { refundable: true, refundFee: 930, changeable: true, changeFee: 500 } };
    const action = await t.service.proposeBooking("c1", [withRules], [], ["A", "B"]);
    expect(action.summary.terms.join(" ")).toContain("fee of INR 930");
    const [b] = (await t.service.confirm(action.id)).bookings;
    expect(cancellationTerms(b, NOW)).toMatchObject({ fee: 930, refund: flight.totalPrice - 930 });
    expect(changeTerms(b, NOW)).toMatchObject({ allowed: true, fee: 500 });
    const locked: FlightOffer = { ...flight, conditions: { refundable: false, refundFee: 0, changeable: false, changeFee: 0 } };
    const [c] = (await t.service.confirm((await t.service.proposeBooking("c1", [locked], [], ["A", "B"])).id)).bookings;
    expect(cancellationTerms(c, NOW).refund).toBe(0);
    expect(changeTerms(c, NOW).allowed).toBe(false);
  });

  it("makes readable references without look-alike characters", () => {
    const ref = makeReference(() => 0.999);
    expect(ref).toHaveLength(6);
    expect(makeReference()).not.toMatch(/[01IO]/);
  });
});

describe("booking tools in the agent loop", () => {
  const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as ModelTurn["content"][number];
  const say = (text: string) => ({ type: "text", text, citations: null }) as ModelTurn["content"][number];

  it("lets the agent propose but never book: bookings appear only after the app confirms", async () => {
    const store = new MemoryStore();
    const bookingStore = new MemoryBookingStore(() => NOW);
    const bookings = new BookingService(bookingStore, () => NOW);
    const events: ChatEvent[] = [];
    const steps: ((req: ModelRequest) => ModelTurn)[] = [
      () => ({ stopReason: "tool_use", content: [use("s", "search_flights", { origin: "Delhi", destination: "Goa", depart_date: "2026-12-18", return_date: "2026-12-22", adults: 2 })] }),
      (req) => {
        const last = req.messages.at(-1)!.content as { content: string }[];
        const id = JSON.parse(last[0].content).offers[0].id;
        return { stopReason: "tool_use", content: [use("u", "update_itinerary", { flight_offer_ids: [id] })] };
      },
      // No ids: uses what is in the itinerary.
      () => ({ stopReason: "tool_use", content: [use("p", "prepare_booking", { traveller_names: ["Asha Rao", "Vikram Rao"] })] }),
      () => ({ stopReason: "end_turn", content: [say("Please check the card and confirm.")] }),
      () => ({ stopReason: "tool_use", content: [use("g", "get_bookings", {})] }),
      () => ({ stopReason: "end_turn", content: [say("You're booked.")] }),
    ];
    const requests: ModelRequest[] = [];
    const model: ModelClient = {
      async streamTurn(req, onText) {
        requests.push(structuredClone(req));
        const turn = steps.shift()!(req);
        for (const b of turn.content) if (b.type === "text") onText(b.text);
        return turn;
      },
    };
    const run = (userText: string) => runAgentTurn({ conversationId: "c1", userText, store, model, providers, bookings, emit: (e) => events.push(e), today: "2026-11-18" });

    await run("Book the cheapest flight for Asha Rao and Vikram Rao");
    const card = events.find((e) => e.type === "confirm");
    expect(card?.action.type).toBe("book");
    expect(bookingStore.bookings).toHaveLength(0); // the agent's turn is over and nothing is booked
    const toolResult = JSON.stringify(requests[3].messages.at(-1)!.content);
    expect(toolResult).toContain("awaiting_traveller_confirmation");
    expect(toolResult).toContain("you cannot confirm it yourself");

    // The traveller presses Confirm in the app.
    const { message } = await bookings.confirm(card!.action.id);
    await run(`Confirmed in the app. ${message}`);
    const listed = JSON.parse((requests.at(-1)!.messages.at(-1)!.content as { content: string }[])[0].content);
    expect(listed.bookings).toHaveLength(1);
    expect(listed.bookings[0]).toMatchObject({ status: "confirmed", kind: "flight", travellers: ["Asha Rao", "Vikram Rao"], from_this_conversation: true });
    expect(listed.bookings[0].if_cancelled_now.allowed).toBe(true);
  });

  it("reports booking problems to the model as errors", async () => {
    const store = new MemoryStore();
    const events: ChatEvent[] = [];
    const requests: ModelRequest[] = [];
    const steps: ModelTurn[] = [
      { stopReason: "tool_use", content: [use("a", "prepare_booking", { traveller_names: ["A"] }), use("b", "request_cancellation", { booking_reference: "NOPE12" }), use("c", "request_change", { booking_reference: "NOPE12", new_offer_id: "x" })] },
      { stopReason: "end_turn", content: [say("Sorry.")] },
    ];
    const model: ModelClient = { async streamTurn(req) { requests.push(structuredClone(req)); return steps.shift()!; } };
    await runAgentTurn({ conversationId: "c1", userText: "book", store, model, providers, emit: (e) => events.push(e) });
    const results = requests[1].messages.at(-1)!.content as { is_error?: boolean; content: string }[];
    expect(results.map((r) => r.is_error)).toEqual([true, true, true]);
    expect(results[0].content).toContain("Nothing was selected");
    expect(results[1].content).toContain("No booking with reference");
    expect(events.some((e) => e.type === "confirm")).toBe(false);
  });
});
