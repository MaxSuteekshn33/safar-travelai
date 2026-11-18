import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildFlightLinks, buildStayLinks } from "@/lib/booking-links";
import { cancellationTerms, changeTerms } from "@/lib/bookings/policy";
import { BookingError, type BookingService } from "@/lib/bookings/service";
import { applyItineraryUpdate, computeBudget, summariseItinerary, type ItineraryUpdate } from "@/lib/itinerary";
import { cleanProfile, LIST_FIELDS } from "@/lib/profile";
import { ProviderError, type Providers } from "@/lib/providers/types";
import type { Store } from "@/lib/store";
import type {
  BookingLink,
  ChatEvent,
  FlightOffer,
  StayOffer,
  TransferEstimate,
  TravelerProfile,
} from "@/lib/types";

export interface ToolContext {
  conversationId: string;
  providers: Providers;
  store: Store;
  bookings: BookingService;
  emit: (event: ChatEvent) => void;
}

export interface ToolOutcome {
  /** Text handed back to the model as the tool result. */
  content: string;
  isError?: boolean;
  /** True when the data came from a mock provider, so the UI can label it. */
  mock?: boolean;
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Short present-tense label shown in the chat while the tool runs. */
  label: (input: z.infer<S>) => string;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}

function define<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const currency = z.string().length(3).default("INR").describe("ISO currency code. Default INR.");
const json = (v: unknown) => JSON.stringify(v);

/** One sentence telling the model how far to trust a batch of offers. */
function dataNote(offers: { source: string; testMode?: boolean }[]): string {
  if (offers.length === 0) return "No offers were found for this search. Say so; do not make any up.";
  if (offers.some((o) => o.source === "mock")) return "Sample data from the built-in mock, not real fares or properties. Say so.";
  if (offers.some((o) => o.testMode)) {
    return "These come from the provider's test mode: the search is real but the airlines, times and prices are fictional test data. Tell the traveller they are test results, not bookable fares.";
  }
  return "Live offers. Prices can change until booked.";
}

// ---------------------------------------------------------------- tools

const searchFlights = define({
  name: "search_flights",
  description:
    "Search flight offers for a route and dates. Returns up to five offers, each with an id, times, stops, baggage and a total price for all travellers. Use the ids with update_itinerary; never retype prices. The result's data_note says whether these are live, test-mode or sample offers; pass that on honestly.",
  schema: z.object({
    origin: z.string().describe("City name or IATA code, e.g. Delhi or DEL"),
    destination: z.string().describe("City name or IATA code"),
    depart_date: date,
    return_date: date.optional().describe("Leave out for one-way"),
    adults: z.number().int().min(1).max(9),
    children: z.number().int().min(0).max(8).optional(),
    cabin: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
    currency,
  }),
  label: (i) => `Searching flights ${i.origin} to ${i.destination}`,
  run: async (i, ctx) => {
    const offers = await ctx.providers.flights.searchFlights({
      origin: i.origin,
      destination: i.destination,
      departDate: i.depart_date,
      returnDate: i.return_date,
      adults: i.adults,
      children: i.children,
      cabin: i.cabin,
      currency: i.currency,
    });
    await ctx.store.saveOffers(ctx.conversationId, "flight", offers);
    const leg = (segs: FlightOffer["outbound"]) => ({
      depart: segs[0].departAt,
      arrive: segs[segs.length - 1].arriveAt,
      flights: segs.map((s) => `${s.carrier} ${s.flightNumber} ${s.from}-${s.to}`),
    });
    return {
      mock: offers.some((o) => o.source === "mock"),
      content: json({
        source: ctx.providers.flights.name,
        data_note: dataNote(offers),
        offers: offers.map((o) => ({
          id: o.id,
          outbound: leg(o.outbound),
          inbound: o.inbound ? leg(o.inbound) : undefined,
          stops: o.stops,
          outbound_duration_minutes: o.durationMinutes,
          cabin: o.cabin,
          baggage: o.baggage,
          total_price: o.totalPrice,
          currency: o.currency,
          travellers: o.travellers,
          notes: o.notes,
        })),
      }),
    };
  },
});

const searchStays = define({
  name: "search_stays",
  description:
    "Search places to stay in a city for given dates. Returns offers with an id, area, type, rating, price per night and total. Use the ids with update_itinerary. The result's data_note says whether these are live, test-mode or sample properties; pass that on honestly.",
  schema: z.object({
    city: z.string(),
    check_in: date,
    check_out: date,
    guests: z.number().int().min(1).max(12),
    rooms: z.number().int().min(1).max(6).optional(),
    max_price_per_night: z.number().positive().optional(),
    currency,
  }),
  label: (i) => `Looking for stays in ${i.city}`,
  run: async (i, ctx) => {
    const offers = await ctx.providers.stays.searchStays({
      city: i.city,
      checkIn: i.check_in,
      checkOut: i.check_out,
      guests: i.guests,
      rooms: i.rooms,
      maxPricePerNight: i.max_price_per_night,
      currency: i.currency,
    });
    await ctx.store.saveOffers(ctx.conversationId, "stay", offers);
    return {
      mock: offers.some((o) => o.source === "mock"),
      content: json({
        source: offers[0]?.source ?? ctx.providers.stays.name,
        data_note: dataNote(offers),
        offers: offers.map((o) => ({
          id: o.id,
          name: o.name,
          area: o.area,
          kind: o.kind,
          stars: o.stars,
          rating_out_of_10: o.rating,
          nights: o.nights,
          rooms: o.rooms,
          price_per_night: o.pricePerNight,
          total_price: o.totalPrice,
          currency: o.currency,
          amenities: o.amenities,
          lat: o.lat,
          lng: o.lng,
          notes: o.notes,
        })),
      }),
    };
  },
});

const estimateTransfers = define({
  name: "estimate_transfers",
  description:
    "Estimate distance, time and rough cost for ground transfers in a city (airport to hotel, hotel to a sight, between stops). These are estimates, never quotes; always say so. Returns ids to pass to update_itinerary. Pass coordinates when you have them from other tool results for a better estimate.",
  schema: z.object({
    city: z.string(),
    legs: z
      .array(
        z.object({
          from: z.string().describe("e.g. Goa airport (GOI)"),
          to: z.string(),
          from_lat: z.number().optional(),
          from_lng: z.number().optional(),
          to_lat: z.number().optional(),
          to_lng: z.number().optional(),
        }),
      )
      .min(1)
      .max(12),
    currency,
  }),
  label: (i) => `Estimating transfers in ${i.city}`,
  run: async (i, ctx) => {
    const raw = await ctx.providers.transfers.estimate(
      i.city,
      i.legs.map((l) => ({
        from: l.from,
        to: l.to,
        fromLat: l.from_lat,
        fromLng: l.from_lng,
        toLat: l.to_lat,
        toLng: l.to_lng,
      })),
      i.currency,
    );
    // Ids must be unique across calls in a conversation.
    const stamp = Date.now().toString(36);
    const estimates = raw.map((e, n) => ({ ...e, id: `tr-${stamp}-${n + 1}` }));
    await ctx.store.saveOffers(ctx.conversationId, "transfer", estimates);
    return {
      content: json({
        note: "Estimates only. Label them as estimates when you mention them.",
        estimates: estimates.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          distance_km: e.distanceKm,
          duration_minutes: e.durationMinutes,
          mode: e.mode,
          cost: e.cost,
          currency: e.currency,
        })),
      }),
    };
  },
});

const researchDestination = define({
  name: "research_destination",
  description:
    "Research sights, food and local tips for a destination by reading recent travel blogs on the web. Takes 15 to 40 seconds. Each recommendation says whether it is verified (its page was read) and carries a source_url. When you use one, pass its source_url and source_title into the itinerary item, and set unverified true if it was not verified. Never add places, prices or opening hours that are not in the result.",
  schema: z.object({
    destination: z.string(),
    interests: z.array(z.string()).optional().describe("e.g. beaches, history, street food"),
    dietary: z.string().optional(),
    month: z.string().optional().describe("Month of travel, e.g. December"),
  }),
  label: (i) => `Reading up on ${i.destination}`,
  run: async (i, ctx) => {
    const result = await ctx.providers.research.research(i);
    return { mock: result.source === "mock", content: json(result) };
  },
});

const getWeather = define({
  name: "get_weather",
  description:
    "Get the weather for a city over a date range (up to 14 days). The result says whether it is a real forecast or only a seasonal guess; word your answer accordingly.",
  schema: z.object({ city: z.string(), start_date: date, end_date: date }),
  label: (i) => `Checking the weather in ${i.city}`,
  run: async (i, ctx) => {
    const result = await ctx.providers.weather.getWeather(i.city, i.start_date, i.end_date);
    return { mock: result.source === "mock", content: json(result) };
  },
});

const itineraryItem = z.object({
  time: z.string().optional().describe('"09:30" or a part of day such as "morning"'),
  title: z.string(),
  kind: z.enum(["sight", "food", "transfer", "flight", "stay", "experience", "free"]),
  note: z.string().optional(),
  cost: z.number().min(0).optional().describe("Cost for the whole party in the trip currency, only if a tool gave it or the traveller said it"),
  cost_is_estimate: z.boolean().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  source_url: z.string().optional().describe("Source link from research_destination, if any"),
  source_title: z.string().optional().describe("Title of that source page, if given"),
  unverified: z.boolean().optional().describe("True if this came from an unverified recommendation"),
});

const updateItinerary = define({
  name: "update_itinerary",
  description:
    "Update the itinerary panel the traveller sees beside the chat. Send only what changed; anything left out is kept. Call this whenever something is decided or proposed (trip basics, chosen flight or stay, a day plan, transfers, extra costs) so the panel stays in step with the conversation. Flights, stays and transfers are set by id from the search tools. The budget total is computed for you from the itinerary; do not compute it yourself.",
  schema: z.object({
    trip: z
      .object({
        title: z.string().optional(),
        origin: z.string().optional(),
        destination: z.string().optional(),
        start_date: date.optional(),
        end_date: date.optional(),
        travellers: z.number().int().min(1).optional(),
        currency: z.string().length(3).optional(),
        budget_total: z.number().positive().optional().describe("The traveller's overall budget, if they gave one"),
      })
      .optional(),
    flight_offer_ids: z.array(z.string()).optional().describe("Replaces the selected flights. [] clears them."),
    stay_offer_ids: z.array(z.string()).optional().describe("Replaces the selected stays. [] clears them."),
    transfer_ids: z.array(z.string()).optional().describe("Replaces the transfer list. [] clears it."),
    days: z
      .array(z.object({ day: z.number().int().min(1), date: date.optional(), title: z.string(), items: z.array(itineraryItem) }))
      .optional()
      .describe("Each entry replaces the day with the same number, or adds it."),
    remove_days: z.array(z.number().int().min(1)).optional(),
    other_costs: z
      .array(z.object({ label: z.string(), amount: z.number().min(0), is_estimate: z.boolean().optional() }))
      .optional()
      .describe("Replaces extra budget lines such as food, visas or shopping."),
  }),
  label: () => "Updating your itinerary",
  run: async (i, ctx) => {
    const update: ItineraryUpdate = {};
    const missing: string[] = [];
    if (i.trip) {
      update.trip = {
        title: i.trip.title,
        origin: i.trip.origin,
        destination: i.trip.destination,
        startDate: i.trip.start_date,
        endDate: i.trip.end_date,
        travellers: i.trip.travellers,
        currency: i.trip.currency?.toUpperCase(),
        budgetTotal: i.trip.budget_total,
      };
    }
    if (i.flight_offer_ids) {
      const r = await ctx.store.getOffers<FlightOffer>(ctx.conversationId, "flight", i.flight_offer_ids);
      update.flights = r.found;
      missing.push(...r.missing);
    }
    if (i.stay_offer_ids) {
      const r = await ctx.store.getOffers<StayOffer>(ctx.conversationId, "stay", i.stay_offer_ids);
      update.stays = r.found;
      missing.push(...r.missing);
    }
    if (i.transfer_ids) {
      const r = await ctx.store.getOffers<TransferEstimate>(ctx.conversationId, "transfer", i.transfer_ids);
      update.transfers = r.found;
      missing.push(...r.missing);
    }
    if (missing.length) {
      return {
        isError: true,
        content: `Nothing was changed. These ids were not found in this conversation's search results: ${missing.join(", ")}. Use ids exactly as returned by search_flights, search_stays or estimate_transfers.`,
      };
    }
    if (i.days) {
      update.days = i.days.map((d) => ({
        day: d.day,
        date: d.date,
        title: d.title,
        items: d.items.map((it) => ({
          time: it.time,
          title: it.title,
          kind: it.kind,
          note: it.note,
          cost: it.cost,
          costIsEstimate: it.cost_is_estimate,
          lat: it.lat,
          lng: it.lng,
          sourceUrl: it.source_url,
          sourceTitle: it.source_title,
          unverified: it.unverified,
        })),
      }));
    }
    update.removeDays = i.remove_days;
    if (i.other_costs) {
      update.otherCosts = i.other_costs.map((c) => ({ label: c.label, amount: c.amount, isEstimate: c.is_estimate }));
    }
    const next = applyItineraryUpdate(await ctx.store.getItinerary(ctx.conversationId), update);
    await ctx.store.saveItinerary(ctx.conversationId, next);
    ctx.emit({ type: "itinerary", itinerary: next, budget: computeBudget(next) });
    return { content: `Itinerary updated.\n${summariseItinerary(next)}` };
  },
});

const updateTravelerProfile = define({
  name: "update_traveler_profile",
  description:
    "Remember, correct or forget something lasting about the traveller for future trips: home city, budget style, dietary preference, pace, airlines or hotels they like, interests, past trips. Call it when you learn such a fact, without asking permission and without announcing it at length. Use the remove and clear fields when the traveller corrects or withdraws something. Do not store one-off details of the current trip. The traveller can see and edit all of this in Settings.",
  schema: z.object({
    name: z.string().optional(),
    home_city: z.string().optional(),
    budget_style: z.enum(["shoestring", "value", "comfort", "luxury"]).optional(),
    dietary: z.string().optional(),
    pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
    add_airline_likes: z.array(z.string()).optional(),
    add_hotel_likes: z.array(z.string()).optional(),
    add_interests: z.array(z.string()).optional(),
    add_notes: z.array(z.string()).optional().describe("Other lasting preferences, one short sentence each"),
    add_past_trips: z
      .array(z.object({ destination: z.string(), when: z.string().optional(), note: z.string().optional() }))
      .optional(),
    remove_items: z
      .array(z.string())
      .optional()
      .describe("Entries to remove from the airline, hotel, interest and note lists, exactly as saved. For past trips, give the destination."),
    clear_fields: z
      .array(z.enum(["name", "home_city", "budget_style", "dietary", "pace"]))
      .optional()
      .describe("Single-value fields to forget"),
  }),
  label: (i) =>
    i.remove_items?.length || i.clear_fields?.length ? "Updating what I remember" : "Noting that for next time",
  run: async (i, ctx) => {
    const p: TravelerProfile = { ...(await ctx.store.getProfile()) };
    const CLEAR = { name: "name", home_city: "homeCity", budget_style: "budgetStyle", dietary: "dietary", pace: "pace" } as const;
    for (const f of i.clear_fields ?? []) delete p[CLEAR[f]];
    if (i.remove_items?.length) {
      const gone = new Set(i.remove_items.map((s) => s.trim().toLowerCase()));
      for (const k of LIST_FIELDS) p[k] = p[k]?.filter((s) => !gone.has(s.toLowerCase()));
      p.pastTrips = p.pastTrips?.filter((t) => !gone.has(t.destination.toLowerCase()));
    }
    if (i.name) p.name = i.name;
    if (i.home_city) p.homeCity = i.home_city;
    if (i.budget_style) p.budgetStyle = i.budget_style;
    if (i.dietary) p.dietary = i.dietary;
    if (i.pace) p.pace = i.pace;
    p.airlineLikes = [...(p.airlineLikes ?? []), ...(i.add_airline_likes ?? [])];
    p.hotelLikes = [...(p.hotelLikes ?? []), ...(i.add_hotel_likes ?? [])];
    p.interests = [...(p.interests ?? []), ...(i.add_interests ?? [])];
    p.notes = [...(p.notes ?? []), ...(i.add_notes ?? [])];
    p.pastTrips = [...(p.pastTrips ?? []), ...(i.add_past_trips ?? [])];
    const saved = cleanProfile(p);
    await ctx.store.saveProfile(saved);
    ctx.emit({ type: "profile", profile: saved });
    return { content: `Saved. Profile is now: ${json(saved)}` };
  },
});

const buildBookingLinks = define({
  name: "build_booking_links",
  description:
    "Build pre-filled search links on Skyscanner, MakeMyTrip and ixigo (flights) and Airbnb and MakeMyTrip (stays) so the traveller can compare and book there themselves. Use these when the traveller wants to make a real booking: Safar's own bookings are only simulated. The links are added to the itinerary panel automatically. A link marked verified false opens the site without a pre-filled search; say so briefly if there is one.",
  schema: z.object({
    flights: z
      .object({
        origin: z.string(),
        destination: z.string(),
        depart_date: date,
        return_date: date.optional(),
        adults: z.number().int().min(1).max(9),
        children: z.number().int().min(0).max(8).optional(),
      })
      .optional(),
    stays: z
      .object({
        city: z.string(),
        check_in: date,
        check_out: date,
        adults: z.number().int().min(1).max(12),
        children: z.number().int().min(0).max(8).optional(),
      })
      .optional(),
  }),
  label: () => "Preparing booking links",
  run: async (i, ctx) => {
    if (!i.flights && !i.stays) return { isError: true, content: "Pass flights, stays or both." };
    const links: BookingLink[] = [];
    const notes: string[] = [];
    if (i.flights) {
      const r = buildFlightLinks({
        origin: i.flights.origin,
        destination: i.flights.destination,
        departDate: i.flights.depart_date,
        returnDate: i.flights.return_date,
        adults: i.flights.adults,
        children: i.flights.children,
      });
      links.push(...r.links);
      if (r.note) notes.push(r.note);
    }
    if (i.stays) {
      links.push(
        ...buildStayLinks({
          city: i.stays.city,
          checkIn: i.stays.check_in,
          checkOut: i.stays.check_out,
          adults: i.stays.adults,
          children: i.stays.children,
        }).links,
      );
    }
    if (links.length) {
      const next = applyItineraryUpdate(await ctx.store.getItinerary(ctx.conversationId), { bookingLinks: links });
      await ctx.store.saveItinerary(ctx.conversationId, next);
      ctx.emit({ type: "itinerary", itinerary: next, budget: computeBudget(next) });
    }
    return { content: json({ links, notes, added_to_itinerary_panel: links.length > 0 }) };
  },
});

const CARD_NOTE =
  "A confirmation card is now showing in the chat. Nothing has happened yet and you cannot confirm it yourself: ask the traveller to review the card and press the button. Do not say it is done until they tell you they confirmed or get_bookings shows it.";

const prepareBooking = define({
  name: "prepare_booking",
  description:
    "Prepare a simulated booking of flights and/or stays for the traveller to confirm. This does not book anything: it shows a confirmation card with the items, total and cancellation terms, and the booking happens only if the traveller presses Confirm. Bookings in this version are simulated (no real reservation, no payment); say so. You need each traveller's name. If you leave out both id lists, the flights and stays currently in the itinerary are used.",
  schema: z.object({
    flight_offer_ids: z.array(z.string()).optional(),
    stay_offer_ids: z.array(z.string()).optional(),
    traveller_names: z.array(z.string()).min(1).max(9).describe("Full name of each traveller, as the traveller gave them"),
  }),
  label: () => "Preparing the booking for you to confirm",
  run: async (i, ctx) => {
    let flights: FlightOffer[];
    let stays: StayOffer[];
    if (!i.flight_offer_ids && !i.stay_offer_ids) {
      const it = await ctx.store.getItinerary(ctx.conversationId);
      flights = it.flights;
      stays = it.stays;
    } else {
      const f = await ctx.store.getOffers<FlightOffer>(ctx.conversationId, "flight", i.flight_offer_ids ?? []);
      const st = await ctx.store.getOffers<StayOffer>(ctx.conversationId, "stay", i.stay_offer_ids ?? []);
      const missing = [...f.missing, ...st.missing];
      if (missing.length) return { isError: true, content: `These ids were not found in this conversation's search results: ${missing.join(", ")}.` };
      flights = f.found;
      stays = st.found;
    }
    const action = await ctx.bookings.proposeBooking(ctx.conversationId, flights, stays, i.traveller_names);
    ctx.emit({ type: "confirm", action });
    return { content: json({ status: "awaiting_traveller_confirmation", summary: action.summary, note: CARD_NOTE }) };
  },
});

const getBookings = define({
  name: "get_bookings",
  description:
    "List the traveller's bookings with reference, status, travellers, price, any disruption, and what cancelling or changing each would cost right now. Use it to answer questions about reservations, to retrieve a confirmation, and before saying anything is booked, cancelled or changed.",
  schema: z.object({}),
  label: () => "Checking your bookings",
  run: async (_i, ctx) => {
    const now = Date.now();
    const all = await ctx.bookings.list();
    return {
      content: json({
        note: all.length ? "All bookings are simulated: no real reservation or payment exists." : "There are no bookings yet.",
        bookings: all.map((b) => ({
          reference: b.reference,
          kind: b.kind,
          status: b.status,
          from_this_conversation: b.conversationId === ctx.conversationId,
          what: b.title,
          travellers: b.travellers,
          price: b.totalPrice,
          currency: b.currency,
          disruption: b.disruption,
          refund_received: b.refundAmount,
          if_cancelled_now: cancellationTerms(b, now),
          if_changed_now: changeTerms(b, now),
          history: b.events.map((e) => `${e.at.slice(0, 16).replace("T", " ")} ${e.text}`),
        })),
      }),
    };
  },
});

const requestCancellation = define({
  name: "request_cancellation",
  description:
    "Ask the traveller to confirm cancelling a booking. Shows a confirmation card with the refund and the terms; the cancellation happens only if they press the button. Explain the refund in a sentence first.",
  schema: z.object({ booking_reference: z.string().describe("The six-character booking reference") }),
  label: (i) => `Preparing to cancel ${i.booking_reference.toUpperCase()}`,
  run: async (i, ctx) => {
    const action = await ctx.bookings.proposeCancellation(ctx.conversationId, i.booking_reference);
    ctx.emit({ type: "confirm", action });
    return { content: json({ status: "awaiting_traveller_confirmation", summary: action.summary, note: CARD_NOTE }) };
  },
});

const requestChange = define({
  name: "request_change",
  description:
    "Ask the traveller to confirm changing a booking to a different flight or stay (rebooking). Search first and pass the id of the replacement offer. Shows a confirmation card with the fare difference and change fee; the change happens only if they press the button. For a disrupted booking there is no change fee.",
  schema: z.object({
    booking_reference: z.string(),
    new_offer_id: z.string().describe("Id of the replacement offer from search_flights or search_stays"),
  }),
  label: (i) => `Preparing a change to ${i.booking_reference.toUpperCase()}`,
  run: async (i, ctx) => {
    const f = await ctx.store.getOffers<FlightOffer>(ctx.conversationId, "flight", [i.new_offer_id]);
    const st = await ctx.store.getOffers<StayOffer>(ctx.conversationId, "stay", [i.new_offer_id]);
    const offer = f.found[0] ?? st.found[0];
    if (!offer) return { isError: true, content: `Offer ${i.new_offer_id} was not found in this conversation's search results. Search again and use an id from the result.` };
    const action = await ctx.bookings.proposeChange(ctx.conversationId, i.booking_reference, offer);
    ctx.emit({ type: "confirm", action });
    return { content: json({ status: "awaiting_traveller_confirmation", summary: action.summary, note: CARD_NOTE }) };
  },
});

// ---------------------------------------------------------------- registry

// Order is fixed: the tool list is part of the cached prompt prefix.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: ToolDef<any>[] = [
  searchFlights,
  searchStays,
  estimateTransfers,
  researchDestination,
  getWeather,
  updateItinerary,
  updateTravelerProfile,
  buildBookingLinks,
  prepareBooking,
  getBookings,
  requestCancellation,
  requestChange,
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void _drop;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
      // Inputs stream as generated; we validate them with Zod before running.
      eager_input_streaming: true,
    };
  });
}

function findTool(name: string) {
  // The model occasionally varies letter case; accept an unambiguous match.
  return TOOLS.find((t) => t.name === name) ?? TOOLS.find((t) => t.name === name.toLowerCase());
}

export function toolLabel(name: string, input: unknown): string {
  const tool = findTool(name);
  if (!tool) return name;
  const parsed = tool.schema.safeParse(input);
  try {
    return parsed.success ? tool.label(parsed.data) : name.replace(/_/g, " ");
  } catch {
    return name.replace(/_/g, " ");
  }
}

/** Validates the input against the tool's schema, runs it, and never throws. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = findTool(name);
  if (!tool) {
    return { isError: true, content: `Unknown tool "${name}". Available tools: ${TOOL_NAMES.join(", ")}.` };
  }
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return {
      isError: true,
      content: json({ INVALID_INPUT: json(input), problems: z.prettifyError(parsed.error) }),
    };
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    if (err instanceof ProviderError || err instanceof BookingError) return { isError: true, content: err.message };
    console.error(`[safar] tool ${name} failed`, err);
    return { isError: true, content: `The ${name} tool failed unexpectedly. Tell the traveller this lookup did not work; do not make up a result.` };
  }
}
