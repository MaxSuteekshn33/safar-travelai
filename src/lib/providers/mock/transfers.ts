import type { TransferEstimate } from "@/lib/types";
import type { TransferLeg, TransferProvider } from "../types";
import { findPlace, fromInr, haversineKm, seeded } from "./places";

/**
 * Estimate-only transfers. With coordinates it uses straight-line distance
 * times a road factor; without them it guesses a typical in-city distance.
 * Nothing here is a quote.
 */
export class EstimateTransferProvider implements TransferProvider {
  readonly name = "estimate";

  async estimate(city: string, legs: TransferLeg[], currency: string): Promise<TransferEstimate[]> {
    const place = findPlace(city);
    const costIndex = place?.costIndex ?? 1;
    return legs.map((leg, i) => {
      const hasCoords = [leg.fromLat, leg.fromLng, leg.toLat, leg.toLng].every((v) => typeof v === "number");
      const involvesAirport = /airport|terminal/i.test(`${leg.from} ${leg.to}`);
      let km: number;
      if (hasCoords) {
        km = haversineKm(leg.fromLat!, leg.fromLng!, leg.toLat!, leg.toLng!) * 1.35;
      } else {
        const rand = seeded(`${city}-${leg.from}-${leg.to}`);
        km = involvesAirport ? 14 + rand() * 22 : 2 + rand() * 9;
      }
      km = Math.max(0.3, Math.round(km * 10) / 10);
      const mode: TransferEstimate["mode"] = km < 1 ? "walk" : km < 4 && !involvesAirport ? "auto" : "cab";
      const speed = mode === "walk" ? 4.5 : 22;
      const inr = mode === "walk" ? 0 : mode === "auto" ? 40 + km * 18 : 120 + km * 24;
      return {
        id: `est-transfer-${i + 1}`,
        source: "estimate",
        from: leg.from,
        to: leg.to,
        distanceKm: km,
        durationMinutes: Math.max(5, Math.round((km / speed) * 60)),
        mode,
        cost: fromInr(inr * costIndex, currency),
        currency: currency.toUpperCase(),
        isEstimate: true,
      };
    });
  }
}
