import type Anthropic from "@anthropic-ai/sdk";
import { BookingService, MemoryBookingStore } from "@/lib/bookings/service";
import type { Providers } from "@/lib/providers/types";
import type { Store, StoredMessage } from "@/lib/store";
import type { ChatEvent } from "@/lib/types";
import { buildTurnContext, SYSTEM_PROMPT } from "./prompt";
import { executeTool, toolDefinitions, toolLabel } from "./tools";

type ContentBlock = Anthropic.Beta.BetaContentBlock;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

export interface ModelRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: StoredMessage[];
  signal?: AbortSignal;
}

export interface ModelTurn {
  content: ContentBlock[];
  stopReason: string | null;
}

/** The one seam between the loop and the model, so tests can script it. */
export interface ModelClient {
  streamTurn(request: ModelRequest, onText: (delta: string) => void): Promise<ModelTurn>;
}

/** Thrown by a ModelClient when the request was cancelled (e.g. the traveller interrupted). */
export class TurnAborted extends Error {}

export interface AgentTurnOptions {
  conversationId: string;
  userText: string;
  voice?: boolean;
  store: Store;
  providers: Providers;
  /** Booking lifecycle; defaults to an in-memory one for tests. */
  bookings?: BookingService;
  model: ModelClient;
  emit: (event: ChatEvent) => void;
  signal?: AbortSignal;
  today?: string;
  maxIterations?: number;
}

const PROFILE_MARKER = "Traveller profile";

function lastContextText(history: StoredMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "system") continue;
    const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => ("text" in b ? b.text : "")).join("");
    if (text.includes(PROFILE_MARKER)) return text;
  }
  return null;
}

const text = (t: string): StoredMessage => ({ role: "assistant", content: [{ type: "text", text: t }] });

/**
 * Runs one traveller turn: appends the message, then loops model -> tools ->
 * model until the model stops calling tools. History is append-only and
 * assistant content is stored exactly as received (thinking blocks included),
 * which the API requires when earlier turns are replayed.
 */
export async function runAgentTurn(opts: AgentTurnOptions): Promise<{ stopReason: string | null }> {
  const { conversationId, store, providers, model, emit, signal } = opts;
  const maxIterations = opts.maxIterations ?? 12;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const messages = await store.listMessages(conversationId);
  const append = async (m: StoredMessage) => {
    messages.push(m);
    await store.appendMessage(conversationId, m);
  };

  await append({ role: "user", content: [{ type: "text", text: opts.userText }] });

  // Per-turn context: date, profile and earlier trips on the first turn; the
  // profile again whenever it changed; plus voice mode.
  const previousContext = lastContextText(messages);
  const context = buildTurnContext({
    today,
    profile: await store.getProfile(),
    voice: !!opts.voice,
    previousContext,
    otherTrips: previousContext === null ? await store.listTrips(conversationId) : undefined,
  });
  if (context) await append({ role: "system", content: context });

  const bookings = opts.bookings ?? new BookingService(new MemoryBookingStore());
  const tools = toolDefinitions();
  let stopReason: string | null = null;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let partial = "";
    let turn: ModelTurn;
    try {
      turn = await model.streamTurn({ system: SYSTEM_PROMPT, tools, messages, signal }, (delta) => {
        partial += delta;
        emit({ type: "text", delta });
      });
    } catch (err) {
      // Keep the history well-formed: every traveller turn ends with an assistant message.
      if (err instanceof TurnAborted || signal?.aborted) {
        await append(text(partial.trim() ? partial : "(The traveller interrupted before I replied.)"));
        emit({ type: "done", stopReason: "aborted" });
        return { stopReason: "aborted" };
      }
      await append(text(partial.trim() ? partial : "(No reply was sent because of a technical error.)"));
      throw err;
    }
    stopReason = turn.stopReason;

    if (stopReason === "refusal") {
      // A refusal can cut a tool call off mid-input, so nothing from this turn is run or replayed.
      const message = "I can't help with that one. Is there another part of the trip I can work on?";
      if (!partial) emit({ type: "text", delta: message });
      await append(text(partial.trim() ? partial : message));
      break;
    }

    await append({ role: "assistant", content: turn.content as Anthropic.Beta.BetaContentBlockParam[] });

    // A long server-side tool turn paused; re-send as is and the server resumes.
    if (stopReason === "pause_turn") continue;

    const toolUses = turn.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break;

    const results: ToolResultParam[] = await Promise.all(
      toolUses.map(async (call): Promise<ToolResultParam> => {
        if (stopReason === "max_tokens") {
          // Input may be silently truncated; never run it.
          return {
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: "This tool call was cut off before its input was complete, so it was not run. Call it again with a shorter input.",
          };
        }
        emit({ type: "tool_start", id: call.id, name: call.name, label: toolLabel(call.name, call.input) });
        const outcome = await executeTool(call.name, call.input, { conversationId, providers, store, bookings, emit });
        emit({ type: "tool_end", id: call.id, name: call.name, ok: !outcome.isError, mock: !!outcome.mock });
        return { type: "tool_result", tool_use_id: call.id, content: outcome.content, is_error: outcome.isError || undefined };
      }),
    );
    // All results go back in one user message, in the order the calls were made.
    await append({ role: "user", content: results });

    if (signal?.aborted) {
      emit({ type: "done", stopReason: "aborted" });
      return { stopReason: "aborted" };
    }
    if (iteration === maxIterations - 1) {
      const message = "I've done a lot of lookups for this one message and stopped there. Tell me what to pick up next.";
      emit({ type: "text", delta: message });
      await append(text(message));
      stopReason = "max_iterations";
    }
  }

  emit({ type: "done", stopReason });
  return { stopReason };
}
