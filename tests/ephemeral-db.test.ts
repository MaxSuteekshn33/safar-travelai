import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// On Vercel only /tmp is writable, so the app keeps SQLite there and creates
// its own tables at first use. This runs that path against a real database.
describe("temporary database on a read-only host", () => {
  const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL, SAFAR_DEMO_DATA: process.env.SAFAR_DEMO_DATA };
  beforeAll(() => {
    rmSync("/tmp/safar.db", { force: true });
    process.env.VERCEL = "1";
    process.env.SAFAR_DEMO_DATA = "0"; // the sample history has its own test
    process.env.DATABASE_URL = "file:./dev.db"; // as a stray .env would supply it
    vi.resetModules();
  });
  afterAll(() => {
    process.env.VERCEL = saved.VERCEL;
    if (saved.DATABASE_URL) process.env.DATABASE_URL = saved.DATABASE_URL;
    else delete process.env.DATABASE_URL;
    if (!saved.VERCEL) delete process.env.VERCEL;
    if (saved.SAFAR_DEMO_DATA) process.env.SAFAR_DEMO_DATA = saved.SAFAR_DEMO_DATA;
    else delete process.env.SAFAR_DEMO_DATA;
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

// Same file as the test above on purpose: both use /tmp/safar.db, so they must not run in parallel.
describe("sample history in a hosted database", () => {
  const saved = { VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL, SAFAR_DEMO_DATA: process.env.SAFAR_DEMO_DATA };
  const restore = (k: keyof typeof saved) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  beforeAll(() => {
    rmSync("/tmp/safar.db", { force: true });
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    delete process.env.SAFAR_DEMO_DATA;
    delete (globalThis as { prisma?: unknown }).prisma; // the first test's client points at the deleted file
    vi.resetModules();
  });
  afterAll(() => {
    restore("VERCEL");
    restore("DATABASE_URL");
    restore("SAFAR_DEMO_DATA");
    rmSync("/tmp/safar.db", { force: true });
  });

  it("is added once to an empty database and is readable through the stores", async () => {
    const db = await import("@/lib/store-prisma");
    const { PrismaBookingStore } = await import("@/lib/bookings/store-prisma");
    const { seedDemoData } = await import("@/lib/demo-seed");
    const store = new db.PrismaStore();

    expect((await store.getProfile()).homeCity).toBe("Delhi");
    const all = await new PrismaBookingStore().listBookings();
    expect(all).toHaveLength(7);
    expect(all.filter((b) => b.status === "cancelled")).toHaveLength(1);
    expect(await new PrismaBookingStore().listBookings("demo-trip-kerala")).toHaveLength(2);
    expect((await store.listTrips("none")).map((t) => t.destination).sort()).toEqual(["Goa", "Jaipur", "Kochi"]);
    expect(await store.listMessages("demo-trip-jaipur")).toHaveLength(2);
    expect((await store.getOffers("demo-trip-kerala", "flight", ["demo-flight-kochi"])).found).toHaveLength(1);

    // A second run adds nothing.
    expect(await seedDemoData(db.prisma as never)).toBe(false);
    expect(await new PrismaBookingStore().listBookings()).toHaveLength(7);
  });
});
