import Anthropic from "@anthropic-ai/sdk";
import { setResearchRunner } from "@/lib/providers";
import type { ResearchRunner } from "@/lib/providers/real/web-research";
import { TurnAborted, type ModelClient, type ModelRequest, type ModelTurn } from "./loop";

export const MODEL = process.env.SAFAR_MODEL ?? "claude-sonnet-5-5";
// "low" keeps time-to-first-word short for chat and voice; raise to "medium"
// with SAFAR_EFFORT if plans need more deliberation.
const EFFORT = (process.env.SAFAR_EFFORT ?? "low") as "low" | "medium" | "high";

let client: Anthropic | undefined;

/** The real model client: one streamed Messages API request per loop iteration. */
export class AnthropicModelClient implements ModelClient {
  async streamTurn(request: ModelRequest, onText: (delta: string) => void): Promise<ModelTurn> {
    client ??= new Anthropic();

    // With eager input streaming, a tool input the SDK cannot parse at all
    // rejects the stream. Only that case is retried; API errors are rethrown.
    for (let attempt = 0; ; attempt++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
          // If a safety classifier declines a request, the API retries it on
          // a fallback model inside the same call where that is allowed.
          fallbacks: "default",
          thinking: {
            type: "adaptive",
            // If the tool list or prompt changes between app versions, drop
            // old thinking blocks instead of failing old conversations.
            block_binding: { prefix_mismatch_behavior: "drop_block" },
          },
          output_config: { effort: EFFORT },
          cache_control: { type: "ephemeral" },
          system: request.system,
          tools: request.tools,
          messages: request.messages,
        },
        { signal: request.signal },
      );
      let streamed = false;
      stream.on("text", (delta) => {
        streamed = true;
        onText(delta);
      });
      try {
        const message = await stream.finalMessage();
        return { content: message.content, stopReason: message.stop_reason };
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError || request.signal?.aborted) throw new TurnAborted();
        if (err instanceof Anthropic.APIError) throw err;
        // Unparseable tool input: retry only if nothing has been shown yet.
        if (streamed || attempt >= 2) throw err;
      }
    }
  }
}

/** One non-interactive request for the research provider, with server-side web search and fetch. */
export const anthropicResearchRunner: ResearchRunner = async ({ system, tools, messages }) => {
  client ??= new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    tools,
    messages,
  });
  return stream.finalMessage();
};
setResearchRunner(anthropicResearchRunner);

/** Turns SDK errors into a sentence the traveller can act on. */
export function describeModelError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY (in .env.local on your machine, or in the project's environment variables on Vercel), then restart or redeploy.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This API key is not allowed to use the model. Check the key's workspace and model access.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "The model is rate limited right now. Wait a few seconds and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The model rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `The model service returned an error (${err.status ?? "unknown"}). Try again in a moment.`;
  }
  if (err instanceof Error && /api[_ ]?key|authToken|credentials/i.test(err.message)) {
    return "No Anthropic API key found. Add ANTHROPIC_API_KEY (to .env.local on your machine, or to the project's environment variables on Vercel), then restart or redeploy.";
  }
  return "Something went wrong while replying. Try again.";
}
