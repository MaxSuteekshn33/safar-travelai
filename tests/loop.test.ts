import { describe, expect, it } from "vitest";
import { runAgentTurn, TurnAborted, type ModelClient, type ModelRequest, type ModelTurn } from "@/lib/agent/loop";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { TOOL_NAMES } from "@/lib/agent/tools";
import { getProviders } from "@/lib/providers";
import { cleanProfile, isEmptyProfile, ProfileSchema } from "@/lib/profile";
import { MemoryStore, type StoredMessage } from "@/lib/store";
import type { ChatEvent } from "@/lib/types";

type Step = (req: ModelRequest) => ModelTurn | Promise<ModelTurn>;

/** A scripted stand-in for the model: each call plays the next step and records the request. */
class ScriptedModel implements ModelClient {
  requests: { system: string; tools: string[]; messages: StoredMessage[] }[] = [];
  constructor(private steps: Step[]) {}
  async streamTurn(req: ModelRequest, onText: (d: string) => void): Promise<ModelTurn> {
    this.requests.push({ system: req.system, tools: req.tools.map((t) => t.name), messages: structuredClone(req.messages) });
    const step = this.steps.shift();
    if (!step) throw new Error("script ran out of steps");
    const turn = await step(req);
    for (const b of turn.content) if (b.type === "text") onText(b.text);
    return turn;
  }
}

const say = (text: string) => ({ type: "text", text, citations: null }) as ModelTurn["content"][number];
const call = (id: string, name: string, input: unknown) =>
  ({ type: "tool_use", id, name, input }) as ModelTurn["content"][number];
const thinking = { type: "thinking", thinking: "", signature: "sig-abc" } as ModelTurn["content"][number];

function setup(steps: Step[]) {
  const store = new MemoryStore();
  const model = new ScriptedModel(steps);
  const events: ChatEvent[] = [];
  const run = (userText: string, extra: { voice?: boolean; signal?: AbortSignal } = {}) =>
    runAgentTurn({
      conversationId: "c1",
      userText,
      store,
      model,
      providers: getProviders(OFFLINE),
      emit: (e) => events.push(e),
      today: "2026-11-18",
      ...extra,
    });
  return { store, model, events, run };
}

/** The tool_result blocks in the last message of a request. */
function resultsIn(messages: StoredMessage[]) {
  const last = messages[messages.length - 1];
  if (last.role !== "user" || typeof last.content === "string") return [];
  return last.content.filter((b) => b.type === "tool_result");
}

const OFFLINE = { SAFAR_OFFLINE: "1" } as unknown as NodeJS.ProcessEnv;

describe("agent tool loop", () => {
  it("answers a plain message in one model call and stores the exchange", async () => {
    const t = setup([() => ({ content: [say("Where are you flying from?")], stopReason: "end_turn" })]);
    const out = await t.run("I want a beach trip");

    expect(out.stopReason).toBe("end_turn");
    expect(t.model.requests).toHaveLength(1);
    expect(t.model.requests[0].system).toBe(SYSTEM_PROMPT);
    expect(t.model.requests[0].tools).toEqual(TOOL_NAMES);
    expect(TOOL_NAMES).toEqual([
      "search_flights", "search_stays", "estimate_transfers", "research_destination",
      "get_weather", "update_itinerary", "update_traveler_profile", "build_booking_links",
      "prepare_booking", "get_bookings", "request_cancellation", "request_change",
    ]);
    const roles = (await t.store.listMessages("c1")).map((m) => m.role);
    expect(roles).toEqual(["user", "system", "assistant"]);
    expect(t.events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Where are you flying from?");
    expect(t.events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("runs tools, feeds results back in one user message, and loops until the model stops", async () => {
    const t = setup([
      () => ({
        content: [
          thinking,
          call("t1", "search_flights", { origin: "Delhi", destination: "Goa", depart_date: "2026-12-18", return_date: "2026-12-22", adults: 2 }),
          call("t2", "search_stays", { city: "Goa", check_in: "2026-12-18", check_out: "2026-12-22", guests: 2 }),
        ],
        stopReason: "tool_use",
      }),
      (req) => {
        const results = resultsIn(req.messages);
        const flights = JSON.parse(results[0].content as string);
        const stays = JSON.parse(results[1].content as string);
        return {
          content: [
            call("t3", "update_itinerary", {
              trip: { title: "Goa for two", destination: "Goa", currency: "INR", budget_total: 60000, travellers: 2 },
              flight_offer_ids: [flights.offers[0].id],
              stay_offer_ids: [stays.offers[0].id],
              days: [{ day: 1, date: "2026-12-18", title: "Arrive", items: [{ title: "Beach walk", kind: "free" }, { title: "Dinner", kind: "food", cost: 1500 }] }],
            }),
          ],
          stopReason: "tool_use",
        };
      },
      () => ({ content: [say("Done, have a look at the panel.")], stopReason: "end_turn" }),
    ]);
    await t.run("Goa, 18 to 22 Dec, two of us from Delhi, about 60k");

    expect(t.model.requests).toHaveLength(3);
    // Parallel calls come back together, in order, in a single user message.
    const second = resultsIn(t.model.requests[1].messages);
    expect(second.map((r) => r.tool_use_id)).toEqual(["t1", "t2"]);
    expect(second.every((r) => !r.is_error)).toBe(true);

    // The assistant turn is replayed exactly as received, thinking block included.
    const replayed = t.model.requests[1].messages.at(-2)!;
    expect(replayed.role).toBe("assistant");
    expect((replayed.content as { type: string }[])[0]).toEqual(thinking);

    // The itinerary holds the full offers looked up by id, and the budget is computed from them.
    const it = await t.store.getItinerary("c1");
    expect(it.flights).toHaveLength(1);
    expect(it.stays).toHaveLength(1);
    const event = t.events.filter((e) => e.type === "itinerary").at(-1)!;
    expect(event.budget.total).toBe(it.flights[0].totalPrice + it.stays[0].totalPrice + 1500);
    expect(event.budget.remaining).toBe(60000 - event.budget.total);

    const tools = t.events.filter((e) => e.type === "tool_end");
    expect(tools.map((e) => [e.name, e.ok, e.mock])).toEqual([
      ["search_flights", true, true],
      ["search_stays", true, true],
      ["update_itinerary", true, false],
    ]);
  });

  it("returns invalid input, unknown tools and unknown offer ids to the model as errors instead of running them", async () => {
    const t = setup([
      () => ({
        content: [
          call("a", "search_flights", { origin: "Delhi" }),
          call("b", "book_everything", {}),
          call("c", "update_itinerary", { flight_offer_ids: ["made-up-id"] }),
          call("d", "search_flights", { origin: "Delhi", destination: "Atlantis", depart_date: "2026-12-18", adults: 1 }),
        ],
        stopReason: "tool_use",
      }),
      () => ({ content: [say("Sorry, let me try that again.")], stopReason: "end_turn" }),
    ]);
    await t.run("book it");

    const results = resultsIn(t.model.requests[1].messages);
    expect(results.map((r) => r.is_error)).toEqual([true, true, true, true]);
    expect(results[0].content).toContain("INVALID_INPUT");
    expect(results[1].content).toContain("Unknown tool");
    expect(results[2].content).toContain("made-up-id");
    expect(results[3].content).toContain("Atlantis");
    expect((await t.store.getItinerary("c1")).flights).toEqual([]);
  });

  it("does not run a tool call that was cut off at max_tokens", async () => {
    const t = setup([
      () => ({ content: [call("x", "update_traveler_profile", { home_city: "Pune" })], stopReason: "max_tokens" }),
      () => ({ content: [say("ok")], stopReason: "end_turn" }),
    ]);
    await t.run("hi");
    expect(resultsIn(t.model.requests[1].messages)[0].is_error).toBe(true);
    expect(await t.store.getProfile()).toEqual({});
    expect(t.events.some((e) => e.type === "tool_start")).toBe(false);
  });

  it("saves the profile, then carries it into later conversations", async () => {
    const t = setup([
      () => ({ content: [call("p", "update_traveler_profile", { home_city: "Pune", dietary: "vegetarian", add_interests: ["beaches"] })], stopReason: "tool_use" }),
      () => ({ content: [say("Noted.")], stopReason: "end_turn" }),
      () => ({ content: [say("Welcome back.")], stopReason: "end_turn" }),
    ]);
    await t.run("I'm vegetarian and based in Pune");
    expect(await t.store.getProfile()).toEqual({ homeCity: "Pune", dietary: "vegetarian", interests: ["beaches"] });
    expect(t.events.some((e) => e.type === "profile")).toBe(true);

    // First context message of the first conversation said nothing was saved.
    const first = t.model.requests[0].messages.find((m) => m.role === "system")!;
    expect(first.content).toContain("nothing saved");
    expect(first.content).toContain("2026-11-18");

    // A new conversation starts with the saved profile in its context.
    await runAgentTurn({
      conversationId: "c2", userText: "Plan something for March", store: t.store, model: t.model,
      providers: getProviders(OFFLINE), emit: () => {}, today: "2027-01-05",
    });
    const context = t.model.requests[2].messages.find((m) => m.role === "system")!;
    expect(context.content).toContain('"homeCity":"Pune"');
    expect(context.content).toContain('"dietary":"vegetarian"');
  });

  it("keeps history append-only across turns and adds context only when something changed", async () => {
    const t = setup([
      () => ({ content: [say("one")], stopReason: "end_turn" }),
      () => ({ content: [say("two")], stopReason: "end_turn" }),
      () => ({ content: [say("three")], stopReason: "end_turn" }),
    ]);
    await t.run("first");
    await t.run("second");
    await t.run("third", { voice: true });

    const [r1, r2, r3] = t.model.requests.map((r) => r.messages);
    expect(r2.slice(0, r1.length)).toEqual(r1);
    expect(r3.slice(0, r2.length + 1)).toEqual([...r2, { role: "assistant", content: [say("two")] }]);
    expect(r2.map((m) => m.role)).toEqual(["user", "system", "assistant", "user"]);
    // The voice turn adds a context message with the voice note but not the profile again.
    const voiceContext = r3.at(-1)!;
    expect(voiceContext.role).toBe("system");
    expect(voiceContext.content).toContain("voice");
    expect(voiceContext.content).not.toContain("Traveller profile");
  });

  it("resumes a paused turn without adding a user message", async () => {
    const t = setup([
      () => ({ content: [say("Searching")], stopReason: "pause_turn" }),
      () => ({ content: [say(" done.")], stopReason: "end_turn" }),
    ]);
    await t.run("research Goa");
    expect(t.model.requests[1].messages.map((m) => m.role)).toEqual(["user", "system", "assistant"]);
  });

  it("stops on a refusal without running that turn's tools", async () => {
    const t = setup([
      () => ({ content: [call("r", "update_traveler_profile", { home_city: "Pune" })], stopReason: "refusal" }),
    ]);
    const out = await t.run("something");
    expect(out.stopReason).toBe("refusal");
    expect(await t.store.getProfile()).toEqual({});
    const stored = await t.store.listMessages("c1");
    expect(stored.at(-1)!.role).toBe("assistant");
    expect(JSON.stringify(stored)).not.toContain("tool_use");
  });

  it("stores what was said before an interruption and ends the turn cleanly", async () => {
    const controller = new AbortController();
    const store = new MemoryStore();
    const events: ChatEvent[] = [];
    const model: ModelClient = {
      async streamTurn(_req, onText) {
        onText("The cheapest flight is");
        controller.abort();
        throw new TurnAborted();
      },
    };
    const out = await runAgentTurn({
      conversationId: "c1", userText: "options?", store, model, signal: controller.signal,
      providers: getProviders(OFFLINE), emit: (e) => events.push(e),
    });
    expect(out.stopReason).toBe("aborted");
    const stored = await store.listMessages("c1");
    expect(stored.at(-1)).toEqual({ role: "assistant", content: [{ type: "text", text: "The cheapest flight is" }] });
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "aborted" });
  });

  it("leaves a well-formed history and rethrows when the model call fails", async () => {
    const t = setup([() => { throw new Error("network down"); }]);
    await expect(t.run("hello")).rejects.toThrow("network down");
    expect((await t.store.listMessages("c1")).map((m) => m.role)).toEqual(["user", "system", "assistant"]);
  });

  it("stops after the iteration limit instead of looping forever", async () => {
    const forever: Step = () => ({ content: [call(`w${Math.random()}`, "get_weather", { city: "Goa", start_date: "2026-12-18", end_date: "2026-12-19" })], stopReason: "tool_use" });
    const t = setup(Array(10).fill(forever));
    const out = await runAgentTurn({
      conversationId: "c1", userText: "weather", store: t.store, model: t.model, maxIterations: 3,
      providers: getProviders(OFFLINE), emit: (e) => t.events.push(e),
    });
    expect(out.stopReason).toBe("max_iterations");
    expect(t.model.requests).toHaveLength(3);
    expect((await t.store.listMessages("c1")).at(-1)!.role).toBe("assistant");
  });
});

describe("traveller memory", () => {
  const reply = (t: string): Step => () => ({ content: [say(t)], stopReason: "end_turn" });
  const contexts = (messages: StoredMessage[]) => messages.filter((m) => m.role === "system").map((m) => m.content as string);

  it("lets the agent correct and forget what it saved", async () => {
    const t = setup([
      () => ({ content: [call("a", "update_traveler_profile", { home_city: "Pune", dietary: "vegetarian", add_interests: ["Beaches", "trekking"], add_past_trips: [{ destination: "Goa", when: "2025" }] })], stopReason: "tool_use" }),
      () => ({ content: [call("b", "update_traveler_profile", { home_city: "Mumbai", clear_fields: ["dietary"], remove_items: ["trekking", "goa"], add_interests: ["beaches"] })], stopReason: "tool_use" }),
      reply("Updated."),
    ]);
    await t.run("some facts, then corrections");
    expect(await t.store.getProfile()).toEqual({ homeCity: "Mumbai", interests: ["Beaches"] });
  });

  it("restates the profile mid-conversation only when it changed, including edits made in Settings", async () => {
    const t = setup([reply("one"), reply("two"), reply("three"), reply("four")]);
    await t.store.saveProfile({ homeCity: "Delhi" });
    await t.run("first");
    await t.run("second");
    expect(contexts(await t.store.listMessages("c1"))).toHaveLength(1);

    await t.store.saveProfile({ homeCity: "Delhi", dietary: "vegan" }); // edited in Settings
    await t.run("third");
    const afterEdit = contexts(await t.store.listMessages("c1"));
    expect(afterEdit).toHaveLength(2);
    expect(afterEdit[1]).toContain('"dietary":"vegan"');
    expect(afterEdit[1]).toContain("replaces any earlier version");
    expect(afterEdit[1]).not.toContain("Today's date");

    await t.run("fourth");
    expect(contexts(await t.store.listMessages("c1"))).toHaveLength(2);
  });

  it("tells the agent when the traveller deleted their profile", async () => {
    const t = setup([reply("one"), reply("two"), reply("three")]);
    await t.store.saveProfile({ dietary: "vegetarian" });
    await t.run("first");
    await t.store.saveProfile({}); // "Delete everything" in Settings
    await t.run("second");
    const after = contexts(await t.store.listMessages("c1"));
    expect(after[1]).toContain("nothing saved");
    expect(after[1]).toContain("stop relying on profile details");
    await t.run("third");
    expect(contexts(await t.store.listMessages("c1"))).toHaveLength(2);
  });

  it("mentions trips planned in other conversations on the first turn of a new one", async () => {
    const t = setup([
      () => ({ content: [call("u", "update_itinerary", { trip: { title: "Goa long weekend", destination: "Goa", start_date: "2026-12-18", end_date: "2026-12-22" } })], stopReason: "tool_use" }),
      reply("planned"),
      reply("hello again"),
    ]);
    await t.run("plan Goa");
    expect(contexts(await t.store.listMessages("c1"))[0]).not.toContain("other conversations");

    await runAgentTurn({
      conversationId: "c2", userText: "something new", store: t.store, model: t.model,
      providers: getProviders(OFFLINE), emit: () => {}, today: "2027-02-01",
    });
    const first = contexts(await t.store.listMessages("c2"))[0];
    expect(first).toContain("Goa long weekend (Goa), 2026-12-18 to 2026-12-22");
    expect(first).toContain("not necessarily taken");
  });
});

describe("profile cleaning and validation", () => {
  it("trims, de-duplicates and drops empty values", () => {
    expect(
      cleanProfile({
        name: "  ", homeCity: " Delhi ", interests: ["Beaches", "beaches ", ""], notes: [],
        pastTrips: [{ destination: "Goa", when: "2025" }, { destination: "goa", when: "2025" }, { destination: " " }],
      }),
    ).toEqual({ homeCity: "Delhi", interests: ["Beaches"], pastTrips: [{ destination: "Goa", when: "2025" }] });
    expect(isEmptyProfile({ name: "", interests: [] })).toBe(true);
  });

  it("rejects malformed input from the settings page and strips unknown keys", () => {
    expect(ProfileSchema.safeParse({ budgetStyle: "extravagant" }).success).toBe(false);
    expect(ProfileSchema.safeParse({ homeCity: "x".repeat(81) }).success).toBe(false);
    expect(ProfileSchema.safeParse({ interests: "beaches" }).success).toBe(false);
    expect(ProfileSchema.parse({ homeCity: "Delhi", isAdmin: true })).toEqual({ homeCity: "Delhi" });
  });
});
