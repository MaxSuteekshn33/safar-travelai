import { z } from "zod";
import { AnthropicModelClient, describeModelError } from "@/lib/agent/anthropic";
import { runAgentTurn } from "@/lib/agent/loop";
import { BookingService } from "@/lib/bookings/service";
import { PrismaBookingStore } from "@/lib/bookings/store-prisma";
import { getProviders } from "@/lib/providers";
import { ensureConversation, EPHEMERAL_DB, PrismaStore } from "@/lib/store-prisma";
import type { ChatEvent } from "@/lib/types";

export const maxDuration = 300;

const Body = z.object({
  conversationId: z.string().nullish(),
  message: z.string().trim().min(1).max(4000),
  voice: z.boolean().optional(),
});

/** POST a traveller message; the reply streams back as server-sent events of ChatEvent. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { id: conversationId, replaced } = await ensureConversation(parsed.data.conversationId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false; // browser went away
        }
      };
      emit({ type: "conversation", id: conversationId });
      if (replaced) {
        emit({
          type: "notice",
          message: EPHEMERAL_DB
            ? "This hosted demo keeps data only temporarily, and the server was recycled, so your earlier conversation is gone. This is a fresh one."
            : "Your earlier conversation could not be found, so this is a fresh one.",
        });
      }
      try {
        await runAgentTurn({
          conversationId,
          userText: parsed.data.message,
          voice: parsed.data.voice,
          store: new PrismaStore(),
          providers: getProviders(),
          bookings: new BookingService(new PrismaBookingStore()),
          model: new AnthropicModelClient(),
          emit,
          // Aborts when the browser cancels the request, e.g. a voice interruption.
          signal: request.signal,
        });
      } catch (err) {
        console.error("[safar] chat turn failed", err);
        emit({ type: "error", message: describeModelError(err) });
        emit({ type: "done", stopReason: "error" });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
