import { PrismaClient } from "@prisma/client";
import { emptyItinerary, type Itinerary, type TravelerProfile } from "@/lib/types";
import type { OfferKind, Store, StoredMessage, TripSummary } from "./store";

import { demoDataEnabled, seedDemoData } from "./demo-seed";
import { SCHEMA_STATEMENTS } from "./schema-sql";

/**
 * Where the SQLite file lives. Locally it is prisma/dev.db (from DATABASE_URL).
 * On Vercel the project files are read-only and only /tmp is writable, so the
 * database goes there. That copy is temporary: it is lost when the server
 * instance is recycled and is not shared between instances.
 */
const onServerlessHost = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
// Any SQLite file path is unusable there (a stray .env can supply one), so only /tmp counts.
export const EPHEMERAL_DB = onServerlessHost && (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:"));
const databaseUrl = EPHEMERAL_DB ? "file:/tmp/safar.db" : (process.env.DATABASE_URL || "file:./dev.db");

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

function createClient() {
  const base = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  // On an ephemeral database the tables must be created at startup. Every
  // query waits for that once; locally the tables come from `npm run db:push`.
  // The same step adds the sample history where that is switched on.
  let ready: Promise<void> | undefined;
  const ensureSchema = () =>
    (ready ??= (async () => {
      if (EPHEMERAL_DB || process.env.SAFAR_AUTO_SCHEMA === "1") {
        for (const statement of SCHEMA_STATEMENTS) await base.$executeRawUnsafe(statement);
      }
      if (!demoDataEnabled(EPHEMERAL_DB)) return;
      try {
        await seedDemoData(base);
      } catch (error) {
        // Sample history is a nicety; the app must work without it.
        console.error("Could not add the sample history:", error);
      }
    })());
  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        await ensureSchema();
        return query(args);
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export class PrismaStore implements Store {
  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: { id: "asc" } });
    return rows.map((r) => ({ role: r.role, content: JSON.parse(r.content) }) as StoredMessage);
  }

  async appendMessage(conversationId: string, message: StoredMessage) {
    await prisma.message.create({
      data: { conversationId, role: message.role, content: JSON.stringify(message.content) },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }

  async getItinerary(conversationId: string): Promise<Itinerary> {
    const c = await prisma.conversation.findUnique({ where: { id: conversationId } });
    return { ...emptyItinerary(), ...parse<Partial<Itinerary>>(c?.itinerary ?? "{}", {}) };
  }

  async saveItinerary(conversationId: string, itinerary: Itinerary) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { itinerary: JSON.stringify(itinerary), title: itinerary.trip.title ?? undefined },
    });
  }

  async saveOffers(conversationId: string, kind: OfferKind, offers: { id: string }[]) {
    for (const o of offers) {
      const id = `${conversationId}:${o.id}`;
      const data = JSON.stringify(o);
      await prisma.offer.upsert({
        where: { id },
        create: { id, conversationId, kind, data },
        update: { data, kind },
      });
    }
  }

  async getOffers<T>(conversationId: string, kind: OfferKind, ids: string[]) {
    const rows = await prisma.offer.findMany({
      where: { conversationId, kind, id: { in: ids.map((i) => `${conversationId}:${i}`) } },
    });
    const byId = new Map(rows.map((r) => [r.id.slice(conversationId.length + 1), JSON.parse(r.data) as T]));
    const found: T[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const o = byId.get(id);
      if (o) found.push(o);
      else missing.push(id);
    }
    return { found, missing };
  }

  async getProfile(): Promise<TravelerProfile> {
    const row = await prisma.profile.findUnique({ where: { id: 1 } });
    return parse<TravelerProfile>(row?.data ?? "{}", {});
  }

  async saveProfile(profile: TravelerProfile) {
    const data = JSON.stringify(profile);
    await prisma.profile.upsert({ where: { id: 1 }, create: { id: 1, data }, update: { data } });
  }

  async listTrips(excludeConversationId: string): Promise<TripSummary[]> {
    const rows = await prisma.conversation.findMany({
      where: { id: { not: excludeConversationId } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { itinerary: true },
    });
    return rows
      .map((r) => parse<Partial<Itinerary>>(r.itinerary, {}).trip ?? {})
      .filter((t) => t.destination || t.title)
      .map((t) => ({ title: t.title, destination: t.destination, startDate: t.startDate, endDate: t.endDate }));
  }
}

/** Returns the conversation to use, and whether a requested one had to be replaced because it no longer exists. */
export async function ensureConversation(id?: string | null): Promise<{ id: string; replaced: boolean }> {
  if (id) {
    const existing = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
    if (existing) return { id: existing.id, replaced: false };
  }
  const created = await prisma.conversation.create({ data: {} });
  return { id: created.id, replaced: !!id };
}
