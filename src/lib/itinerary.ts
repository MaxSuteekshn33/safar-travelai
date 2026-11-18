import type {
  BookingLink,
  BudgetSummary,
  CostLine,
  FlightOffer,
  Itinerary,
  ItineraryDay,
  StayOffer,
  TransferEstimate,
  TripMeta,
} from "@/lib/types";

/** A partial change to the itinerary. Anything left out is kept as it is. */
export interface ItineraryUpdate {
  trip?: TripMeta;
  /** Replaces the selected flights. */
  flights?: FlightOffer[];
  /** Replaces the selected stays. */
  stays?: StayOffer[];
  /** Replaces the transfer list. */
  transfers?: TransferEstimate[];
  /** Each day replaces the day with the same number, or is added. */
  days?: ItineraryDay[];
  removeDays?: number[];
  /** Replaces the extra cost lines (food, visas, shopping…). */
  otherCosts?: CostLine[];
  /** Merged by site and kind. */
  bookingLinks?: BookingLink[];
}

export function applyItineraryUpdate(current: Itinerary, update: ItineraryUpdate): Itinerary {
  const next: Itinerary = structuredClone(current);
  if (update.trip) {
    for (const [k, v] of Object.entries(update.trip)) {
      if (v !== undefined && v !== null) (next.trip as Record<string, unknown>)[k] = v;
    }
  }
  if (update.flights) next.flights = update.flights;
  if (update.stays) next.stays = update.stays;
  if (update.transfers) next.transfers = update.transfers;
  if (update.removeDays?.length) {
    next.days = next.days.filter((d) => !update.removeDays!.includes(d.day));
  }
  if (update.days) {
    for (const day of update.days) {
      const i = next.days.findIndex((d) => d.day === day.day);
      if (i >= 0) next.days[i] = day;
      else next.days.push(day);
    }
    next.days.sort((a, b) => a.day - b.day);
  }
  if (update.otherCosts) next.otherCosts = update.otherCosts;
  if (update.bookingLinks) {
    for (const link of update.bookingLinks) {
      const i = next.bookingLinks.findIndex((l) => l.site === link.site && l.kind === link.kind);
      if (i >= 0) next.bookingLinks[i] = link;
      else next.bookingLinks.push(link);
    }
  }
  return next;
}

/**
 * The running budget is always computed here from the itinerary, never typed
 * by the model, so the total always equals the sum of the lines shown.
 */
export function computeBudget(it: Itinerary): BudgetSummary {
  const currency = it.trip.currency ?? it.flights[0]?.currency ?? it.stays[0]?.currency ?? "INR";
  const lines: BudgetSummary["lines"] = [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  if (it.flights.length) {
    lines.push({ label: "Flights", amount: sum(it.flights.map((f) => f.totalPrice)), isEstimate: false });
  }
  if (it.stays.length) {
    lines.push({ label: "Stays", amount: sum(it.stays.map((s) => s.totalPrice)), isEstimate: false });
  }
  if (it.transfers.length) {
    lines.push({ label: "Transfers", amount: sum(it.transfers.map((t) => t.cost)), isEstimate: true });
  }
  const itemCosts = it.days.flatMap((d) => d.items).filter((i) => typeof i.cost === "number" && i.cost > 0);
  if (itemCosts.length) {
    lines.push({
      label: "Activities and meals in the plan",
      amount: sum(itemCosts.map((i) => i.cost!)),
      isEstimate: itemCosts.some((i) => i.costIsEstimate !== false),
    });
  }
  for (const c of it.otherCosts) {
    lines.push({ label: c.label, amount: c.amount, isEstimate: c.isEstimate !== false });
  }

  const total = sum(lines.map((l) => l.amount));
  const budgetTotal = it.trip.budgetTotal;
  return {
    currency,
    lines,
    total,
    budgetTotal,
    remaining: typeof budgetTotal === "number" ? budgetTotal - total : undefined,
  };
}

/** Short text summary returned to the model after an update, so it does not need the full JSON. */
export function summariseItinerary(it: Itinerary): string {
  const b = computeBudget(it);
  const parts = [
    `trip: ${JSON.stringify(it.trip)}`,
    `flights: ${it.flights.map((f) => f.id).join(", ") || "none"}`,
    `stays: ${it.stays.map((s) => s.id).join(", ") || "none"}`,
    `transfers: ${it.transfers.length}`,
    `days: ${it.days.map((d) => `${d.day} (${d.items.length} items)`).join(", ") || "none"}`,
    `budget total so far: ${b.total} ${b.currency}` +
      (b.remaining !== undefined ? `, remaining against budget: ${b.remaining} ${b.currency}` : ""),
  ];
  return parts.join("\n");
}
