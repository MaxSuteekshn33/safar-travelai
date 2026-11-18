import type { FlightOffer, StayOffer } from "@/lib/types";
import { isFlight, type Booking } from "./types";

// Simulated fare rules. They are deliberately simple and are shown to the
// traveller before anything is confirmed. Real rules come from the airline
// or property and would replace this file.

const HOUR = 3600_000;

export interface Terms {
  allowed: boolean;
  /** Fee charged for the action, in the booking currency. */
  fee: number;
  /** Money returned to the traveller if they cancel. */
  refund: number;
  explanation: string;
}

function startsAt(offer: FlightOffer | StayOffer): number {
  return Date.parse(isFlight(offer) ? `${offer.outbound[0].departAt}:00Z` : `${offer.checkIn}T14:00:00Z`);
}

const noteSays = (offer: FlightOffer | StayOffer, pattern: RegExp) => (offer.notes ?? []).some((n) => pattern.test(n));
const round = (n: number) => Math.round(n / 10) * 10;

export function cancellationTerms(b: Booking, now: number): Terms {
  if (b.status === "cancelled") return { allowed: false, fee: 0, refund: 0, explanation: "This booking is already cancelled." };
  if (b.status === "disrupted") {
    return { allowed: true, fee: 0, refund: b.totalPrice, explanation: "The provider disrupted this booking, so cancelling gives a full refund." };
  }
  const start = startsAt(b.offer);
  if (now >= start) return { allowed: false, fee: 0, refund: 0, explanation: "This has already started, so it can no longer be cancelled." };

  if (isFlight(b.offer)) {
    const c = b.offer.conditions;
    if (c ? !c.refundable : noteSays(b.offer, /not refundable/i)) {
      return { allowed: true, fee: b.totalPrice, refund: 0, explanation: "This fare is non-refundable: cancelling returns nothing." };
    }
    if (c) {
      const fee = Math.min(b.totalPrice, c.refundFee);
      return { allowed: true, fee, refund: b.totalPrice - fee, explanation: fee ? `Refundable before departure for a fee of ${b.currency} ${fee.toLocaleString("en-IN")}, as set by the fare.` : "Fully refundable before departure." };
    }
    const fee = round(b.totalPrice * 0.15);
    return { allowed: true, fee, refund: b.totalPrice - fee, explanation: "Refundable before departure with a 15% cancellation fee." };
  }
  if (start - now >= 48 * HOUR) {
    return { allowed: true, fee: 0, refund: b.totalPrice, explanation: "Free cancellation until 48 hours before check-in." };
  }
  const fee = Math.min(b.totalPrice, (b.offer as StayOffer).pricePerNight * (b.offer as StayOffer).rooms);
  return { allowed: true, fee, refund: b.totalPrice - fee, explanation: "Within 48 hours of check-in, the first night is charged." };
}

export function changeTerms(b: Booking, now: number): Terms {
  if (b.status === "cancelled") return { allowed: false, fee: 0, refund: 0, explanation: "A cancelled booking cannot be changed." };
  if (b.status === "disrupted") return { allowed: true, fee: 0, refund: 0, explanation: "The provider disrupted this booking, so rebooking carries no change fee." };
  const start = startsAt(b.offer);
  if (now >= start) return { allowed: false, fee: 0, refund: 0, explanation: "This has already started, so it can no longer be changed." };
  if (isFlight(b.offer)) {
    const c = b.offer.conditions;
    if (c ? !c.changeable : noteSays(b.offer, /changes not allowed/i)) {
      return { allowed: false, fee: 0, refund: 0, explanation: "This fare does not allow changes. It would have to be cancelled and rebooked." };
    }
    if (c) return { allowed: true, fee: c.changeFee, refund: 0, explanation: `Changes cost ${b.currency} ${c.changeFee.toLocaleString("en-IN")}, as set by the fare, plus any fare difference.` };
    return { allowed: true, fee: round(b.totalPrice * 0.1), refund: 0, explanation: "Changes cost a 10% fee plus any fare difference." };
  }
  if (start - now >= 48 * HOUR) return { allowed: true, fee: 0, refund: 0, explanation: "Free to change until 48 hours before check-in; you pay or get back any price difference." };
  return { allowed: false, fee: 0, refund: 0, explanation: "Within 48 hours of check-in the stay can no longer be changed." };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

export function makeReference(random: () => number = Math.random): string {
  return Array.from({ length: 6 }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join("");
}

export function describeOffer(offer: FlightOffer | StayOffer): string {
  if (isFlight(offer)) {
    const first = offer.outbound[0];
    const last = offer.outbound[offer.outbound.length - 1];
    const back = offer.inbound?.[0];
    return (
      `${first.carrier} ${first.from} to ${last.to}, ${first.departAt.replace("T", " ")}` +
      (back ? `, returning ${back.departAt.replace("T", " ")}` : "")
    );
  }
  return `${offer.name}, ${offer.city}, ${offer.checkIn} to ${offer.checkOut} (${offer.nights} night${offer.nights === 1 ? "" : "s"})`;
}
