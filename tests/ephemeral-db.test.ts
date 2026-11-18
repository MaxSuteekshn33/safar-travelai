import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// On Vercel only /tmp is writable, so the app keeps SQLite there and creates
// its own tables at first use. This runs that path against a real database.
describe("temporary database on a read-only host", () => {
  const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL };
  beforeAll(() => {
    rmSync("/tmp/safar.db", { force: true });
    process.env.VERCEL = "1";
    process.env.DATABASE_URL = "file:./dev.db"; // as a stray .env would supply it
    vi.resetModules();
  });
  afterAll(() => {
    process.env.VERCEL = saved.VERCEL;
    if (saved.DATABASE_URL) process.env.DATABASE_URL = saved.DATABASE_URL;
    else delete process.env.DATABASE_URL;
    if (!saved.VERCEL) delete process.env.VERCEL;
    rmSync("/tmp/safar.db", { force: true });
  });

  it("creates the schema on first query and stores conversations, profile and bookings", async () => {
    const db = await import("@/lib/store-prisma");
    const { PrismaBookingStore } = await import("@/lib/bookings/store-prisma");
    expect(db.EPHEMERAL_DB).toBe(true);

    const first = await db.ensureConversation(null);
    expect(first.replaced).toBe(false);
    const store = new db.PrismaStore();
    await store.appendMessage(first.id, { role: "user", content: [{ type: "text", text: "hello" }] });
    expect(await store.listMessages(first.id)).toHaveLength(1);
    await store.saveProfile({ homeCity: "Delhi" });
    expect(await store.getProfile()).toEqual({ homeCity: "Delhi" });

    // An id from a recycled server instance is replaced, and the caller is told.
    const lost = await db.ensureConversation("id-from-another-instance");
    expect(lost.replaced).toBe(true);
    expect(lost.id).not.toBe("id-from-another-instance");

    const bookings = new PrismaBookingStore();
    const action = await bookings.createAction({ conversationId: first.id, type: "book", summary: { title: "t", lines: [], amount: 1, currency: "INR", terms: [], confirmLabel: "c" }, payload: { travellers: ["A"], flights: [], stays: [] } });
    expect((await bookings.listPendingActions(first.id))[0].id).toBe(action.id);
    await db.prisma.$disconnect();
  });
});
