import { z } from "zod";
import type { TravelerProfile } from "@/lib/types";

const short = z.string().trim().max(80);
const list = (maxLen: number) => z.array(z.string().trim().min(1).max(maxLen)).max(40);

/** Shape accepted from the settings page. Unknown keys are dropped. */
export const ProfileSchema = z.object({
  name: short.optional(),
  homeCity: short.optional(),
  budgetStyle: z.enum(["shoestring", "value", "comfort", "luxury"]).optional(),
  dietary: short.optional(),
  pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
  airlineLikes: list(80).optional(),
  hotelLikes: list(80).optional(),
  interests: list(80).optional(),
  notes: list(240).optional(),
  pastTrips: z
    .array(z.object({ destination: short.min(1), when: short.optional(), note: z.string().trim().max(240).optional() }))
    .max(60)
    .optional(),
});

export const LIST_FIELDS = ["airlineLikes", "hotelLikes", "interests", "notes"] as const;
export const SCALAR_FIELDS = ["name", "homeCity", "budgetStyle", "dietary", "pace"] as const;

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Trims, de-duplicates and drops empty values so "nothing saved" is always `{}`. */
export function cleanProfile(input: TravelerProfile): TravelerProfile {
  const out: TravelerProfile = {};
  for (const k of SCALAR_FIELDS) {
    const v = input[k]?.trim();
    if (v) (out as Record<string, string>)[k] = v;
  }
  for (const k of LIST_FIELDS) {
    const v = dedupe((input[k] ?? []).map((s) => s.trim()));
    if (v.length) out[k] = v;
  }
  const trips = (input.pastTrips ?? [])
    .map((t) => ({
      destination: t.destination.trim(),
      ...(t.when?.trim() ? { when: t.when.trim() } : {}),
      ...(t.note?.trim() ? { note: t.note.trim() } : {}),
    }))
    .filter((t) => t.destination);
  const seen = new Set<string>();
  const uniqueTrips = trips.filter((t) => {
    const k = `${t.destination.toLowerCase()}|${(t.when ?? "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (uniqueTrips.length) out.pastTrips = uniqueTrips;
  return out;
}

export function isEmptyProfile(p: TravelerProfile): boolean {
  return Object.keys(cleanProfile(p)).length === 0;
}
