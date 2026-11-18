import { z } from "zod";
import { cancellationTerms, changeTerms } from "@/lib/bookings/policy";
import { BookingError, BookingService } from "@/lib/bookings/service";
import { PrismaBookingStore } from "@/lib/bookings/store-prisma";

const service = new BookingService(new PrismaBookingStore());

/** GET /api/bookings[?conversationId=] -> bookings with their current cancel/change terms, plus pending confirmations. */
export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId") ?? undefined;
  const now = Date.now();
  const bookings = (await service.list(conversationId)).map((b) => ({ ...b, cancelTerms: cancellationTerms(b, now), changeTerms: changeTerms(b, now) }));
  const pending = conversationId ? await service.pending(conversationId) : [];
  return Response.json({ bookings, pending });
}

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("confirm"), actionId: z.string() }),
  z.object({ op: z.literal("decline"), actionId: z.string() }),
  z.object({ op: z.literal("cancel"), reference: z.string() }),
  z.object({ op: z.literal("disrupt"), bookingId: z.string() }),
]);

/**
 * The only place a booking is ever made, changed or cancelled. It is called
 * by the app when the traveller presses a button; the agent has no tool
 * that reaches it.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.op === "confirm") {
      const { bookings, message } = await service.confirm(body.actionId);
      return Response.json({ ok: true, message, bookings });
    }
    if (body.op === "decline") {
      await service.decline(body.actionId);
      return Response.json({ ok: true, message: "Not confirmed. Nothing was changed." });
    }
    if (body.op === "cancel") {
      // From the My trips page: the traveller already confirmed in a dialog there.
      const booking = (await service.list()).find((b) => b.reference === body.reference.toUpperCase());
      if (!booking) throw new BookingError("That booking was not found.");
      const action = await service.proposeCancellation(booking.conversationId ?? "my-trips", booking.reference);
      const { bookings, message } = await service.confirm(action.id);
      return Response.json({ ok: true, message, bookings });
    }
    return Response.json({ ok: true, bookings: [await service.disrupt(body.bookingId)], message: "Disruption simulated." });
  } catch (err) {
    if (err instanceof BookingError) return Response.json({ error: err.message }, { status: 409 });
    console.error("[safar] booking action failed", err);
    return Response.json({ error: "That did not work. Try again." }, { status: 500 });
  }
}
