import { prisma } from "@/lib/store-prisma";
import type { Booking, BookingStore, PendingAction } from "./types";

type BookingRow = { id: string; reference: string; conversationId: string | null; kind: string; status: string; data: string; createdAt: Date };
type ActionRow = { id: string; conversationId: string; type: string; status: string; summary: string; payload: string; createdAt: Date };

// The row's own columns are authoritative; `data` carries the rest.
const toBooking = (r: BookingRow): Booking => ({
  ...(JSON.parse(r.data) as Booking),
  id: r.id,
  reference: r.reference,
  conversationId: r.conversationId,
  kind: r.kind as Booking["kind"],
  status: r.status as Booking["status"],
  createdAt: r.createdAt.toISOString(),
});
const toAction = (r: ActionRow): PendingAction => ({
  id: r.id,
  conversationId: r.conversationId,
  type: r.type as PendingAction["type"],
  status: r.status as PendingAction["status"],
  summary: JSON.parse(r.summary),
  payload: JSON.parse(r.payload),
  createdAt: r.createdAt.toISOString(),
});

export class PrismaBookingStore implements BookingStore {
  async createBooking(b: Omit<Booking, "id" | "createdAt">) {
    const row = await prisma.booking.create({
      data: { reference: b.reference, conversationId: b.conversationId, kind: b.kind, status: b.status, data: JSON.stringify(b) },
    });
    return toBooking(row);
  }
  async updateBooking(id: string, patch: Partial<Booking>) {
    const current = await prisma.booking.findUniqueOrThrow({ where: { id } });
    const next = { ...toBooking(current), ...patch };
    const row = await prisma.booking.update({ where: { id }, data: { status: next.status, kind: next.kind, data: JSON.stringify(next) } });
    return toBooking(row);
  }
  async getBooking(id: string) {
    const row = await prisma.booking.findUnique({ where: { id } });
    return row ? toBooking(row) : null;
  }
  async findByReference(reference: string) {
    const row = await prisma.booking.findUnique({ where: { reference } });
    return row ? toBooking(row) : null;
  }
  async listBookings(conversationId?: string) {
    const rows = await prisma.booking.findMany({ where: conversationId ? { conversationId } : {}, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map(toBooking);
  }
  async createAction(a: Omit<PendingAction, "id" | "createdAt" | "status">) {
    // A newer proposal replaces older unanswered ones in the same conversation.
    await prisma.pendingAction.updateMany({ where: { conversationId: a.conversationId, status: "pending" }, data: { status: "declined" } });
    const row = await prisma.pendingAction.create({
      data: { conversationId: a.conversationId, type: a.type, summary: JSON.stringify(a.summary), payload: JSON.stringify(a.payload) },
    });
    return toAction(row);
  }
  async getAction(id: string) {
    const row = await prisma.pendingAction.findUnique({ where: { id } });
    return row ? toAction(row) : null;
  }
  async setActionStatus(id: string, status: PendingAction["status"]) {
    await prisma.pendingAction.update({ where: { id }, data: { status } });
  }
  async listPendingActions(conversationId: string) {
    const rows = await prisma.pendingAction.findMany({ where: { conversationId, status: "pending" }, orderBy: { createdAt: "asc" } });
    return rows.map(toAction);
  }
}
