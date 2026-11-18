import "@/lib/agent/anthropic"; // registers the web research runner so provider status is accurate
import { computeBudget } from "@/lib/itinerary";
import { providerStatus } from "@/lib/providers";
import { EPHEMERAL_DB, prisma, PrismaStore } from "@/lib/store-prisma";


export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

/**
 * GET /api/conversations            -> list of saved conversations
 * GET /api/conversations?id=<id>    -> transcript, itinerary and budget for one
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const providers = providerStatus();
  const hasModelKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

  if (!id) {
    const rows = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    });
    return Response.json({
      providers,
      hasModelKey,
      ephemeral: EPHEMERAL_DB,
      conversations: rows
        .filter((r) => r._count.messages > 0)
        .map((r) => ({ id: r.id, title: r.title ?? "Untitled trip", updatedAt: r.updatedAt })),
    });
  }

  const exists = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });

  const store = new PrismaStore();
  const [messages, itinerary] = await Promise.all([store.listMessages(id), store.getItinerary(id)]);

  // Only what a person said or read: skip context messages, tool calls and tool results.
  const transcript: TranscriptEntry[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    const text = blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text) continue;
    const last = transcript[transcript.length - 1];
    if (last && last.role === m.role && m.role === "assistant") last.text += `\n\n${text}`;
    else transcript.push({ role: m.role, text });
  }

  return Response.json({ id, transcript, itinerary, budget: computeBudget(itinerary), providers, hasModelKey });
}

/** DELETE /api/conversations?id=<id> removes one saved trip with its messages and search results. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  await prisma.conversation.deleteMany({ where: { id } });
  return Response.json({ ok: true });
}
