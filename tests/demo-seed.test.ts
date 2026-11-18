import { describe, expect, it } from "vitest";
import { cancellationTerms, changeTerms } from "@/lib/bookings/policy";
import { isFlight, type Booking } from "@/lib/bookings/types";
import { buildDemoData, demoDataEnabled } from "@/lib/demo-seed";
import { computeBudget } from "@/lib/itinerary";
import { ProfileSchema } from "@/lib/profile";

const NOW = Date.parse("2026-11-18T09:00:00Z");

describe("sample history", () => {
  const data = buildDemoData(NOW);
  const bookings = data.trips.flatMap((t) => t.bookings);
  const asBooking = (b: (typeof bookings)[number]): Booking => ({ ...b, id: b.reference });

  it("is on for a hosted copy, opt-in locally, and can be switched off", () => {
    expect(demoDataEnabled(true, {})).toBe(true);
    expect(demoDataEnabled(false, {})).toBe(false);
    expect(demoDataEnabled(false, { SAFAR_DEMO_DATA: "1" })).toBe(true);
    expect(demoDataEnabled(true, { SAFAR_DEMO_DATA: "0" })).toBe(false);
  });

  it("has past trips and one upcoming trip, with unique booking references", () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    const ends = data.trips.map((t) => t.itinerary.trip.endDate!);
    expect(ends.filter((d) => d < today)).toHaveLength(2);
    expect(data.trips.filter((t) => t.itinerary.trip.startDate! > today)).toHaveLength(1);
    expect(new Set(bookings.map((b) => b.reference)).size).toBe(bookings.length);
    for (const b of bookings) expect(b.reference).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("is consistent: every booking is simulated, labelled sample, and matches its offer", () => {
    for (const t of data.trips) {
      const offerIds = [...t.itinerary.flights, ...t.itinerary.stays].map((o) => o.id);
      expect(t.bookings.filter((b) => b.status === "confirmed").map((b) => b.offer.id).sort()).toEqual([...offerIds].sort());
      expect(t.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(computeBudget(t.itinerary).total).toBeLessThanOrEqual(t.itinerary.trip.budgetTotal!);
      for (const b of t.bookings) {
        expect(b.simulated).toBe(true);
        expect(b.conversationId).toBe(t.id);
        expect(b.totalPrice).toBe(b.offer.totalPrice);
        expect(b.offer.source).toBe("mock");
        expect(b.offer.notes?.join(" ")).toMatch(/fictional/);
        if (isFlight(b.offer)) expect(b.offer.travellers).toBe(b.travellers.length);
        else expect(b.offer.name).toMatch(/\(sample\)$/);
      }
    }
  });

  it("lets the upcoming trip be changed or cancelled, and not the finished ones", () => {
    for (const b of bookings.filter((x) => x.status === "confirmed")) {
      const upcoming = b.conversationId === "demo-trip-kerala";
      expect(cancellationTerms(asBooking(b), NOW).allowed).toBe(upcoming);
      expect(changeTerms(asBooking(b), NOW).allowed).toBe(upcoming);
    }
    const cancelled = bookings.filter((b) => b.status === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].refundAmount).toBe(cancelled[0].totalPrice);
  });

  it("has a profile the settings page accepts", () => {
    expect(ProfileSchema.safeParse(data.profile).success).toBe(true);
  });
});
