import type { Recommendation, ResearchResult } from "@/lib/types";
import type { ResearchProvider, ResearchQuery } from "../types";
import { findPlace } from "./places";

// Offline sample notes for a few destinations. These are well-known places,
// but nothing here was checked against a live source, so every entry is
// marked unverified and carries no source link. The real provider
// (milestone 4) replaces this with web research and citations.
const SAMPLES: Record<string, Omit<Recommendation, "verified">[]> = {
  GOI: [
    { name: "Fontainhas, Panjim", category: "area", summary: "The old Latin Quarter: narrow lanes of painted Portuguese-era houses, good for a slow morning walk.", lat: 15.4969, lng: 73.8318 },
    { name: "Basilica of Bom Jesus, Old Goa", category: "sight", summary: "16th-century church and UNESCO site; pair with Se Cathedral across the road.", lat: 15.5009, lng: 73.9116 },
    { name: "Palolem Beach", category: "sight", summary: "Crescent-shaped beach in South Goa, calmer than the northern stretch.", lat: 15.01, lng: 74.0232 },
    { name: "Chapora Fort", category: "sight", summary: "Hilltop ruins with a sunset view over Vagator.", lat: 15.6058, lng: 73.7364 },
    { name: "Goan fish thali", category: "food", summary: "A lunchtime staple at local family-run places; ask for the day's catch. Vegetarian thalis are common too." },
  ],
  JAI: [
    { name: "Amber Fort", category: "sight", summary: "Hill fort north of the city; go early to avoid heat and queues.", lat: 26.9855, lng: 75.8513 },
    { name: "City Palace", category: "sight", summary: "Royal residence and museum in the old city, next to Jantar Mantar.", lat: 26.9258, lng: 75.8237 },
    { name: "Hawa Mahal", category: "sight", summary: "The pink sandstone facade is best seen from the street or a cafe opposite.", lat: 26.9239, lng: 75.8267 },
    { name: "Nahargarh Fort", category: "sight", summary: "Ridge-top fort with a wide view of the city at sunset.", lat: 26.9373, lng: 75.8155 },
    { name: "Dal baati churma", category: "food", summary: "Rajasthani staple of baked wheat balls, lentils and a sweet crumble; vegetarian by default." },
  ],
  COK: [
    { name: "Fort Kochi waterfront", category: "area", summary: "Chinese fishing nets and colonial streets; walkable in an evening.", lat: 9.9678, lng: 76.2424 },
    { name: "Mattancherry Palace", category: "sight", summary: "Small palace known for its Kerala murals.", lat: 9.9582, lng: 76.2593 },
    { name: "Alleppey backwaters", category: "experience", summary: "Day cruise or overnight houseboat, about 1.5 hours south of Kochi.", lat: 9.4981, lng: 76.3388 },
    { name: "Kerala sadya", category: "food", summary: "Vegetarian feast served on a banana leaf, easiest to find at lunch." },
  ],
  DXB: [
    { name: "Al Fahidi Historical Neighbourhood", category: "area", summary: "Restored wind-tower houses by the creek; combine with an abra ride to the souks.", lat: 25.2637, lng: 55.2972 },
    { name: "Burj Khalifa and Dubai Fountain", category: "sight", summary: "Observation decks need timed tickets; the fountain show outside is free in the evening.", lat: 25.1972, lng: 55.2744 },
    { name: "Desert safari", category: "experience", summary: "Half-day trips with dune driving and dinner; quality varies a lot by operator." },
  ],
  SIN: [
    { name: "Gardens by the Bay", category: "sight", summary: "The outdoor Supertree Grove is free; the two cooled domes are ticketed.", lat: 1.2816, lng: 103.8636 },
    { name: "Hawker centres", category: "food", summary: "Cheap, varied meals; Little India has the widest vegetarian choice.", lat: 1.3066, lng: 103.8518 },
    { name: "Chinatown and Kampong Glam", category: "area", summary: "Two compact heritage districts that work well on foot in half a day each.", lat: 1.2838, lng: 103.8436 },
  ],
  BKK: [
    { name: "Grand Palace and Wat Pho", category: "sight", summary: "Neighbouring sights in the old town; dress code applies at both.", lat: 13.75, lng: 100.4913 },
    { name: "Chao Phraya river boats", category: "experience", summary: "The public boats are the cheapest way to hop between riverside sights." },
    { name: "Chatuchak Weekend Market", category: "sight", summary: "Huge market open on weekends; go in the morning before the heat.", lat: 13.7999, lng: 100.5506 },
  ],
};

export class MockResearchProvider implements ResearchProvider {
  readonly name = "mock";

  async research(q: ResearchQuery): Promise<ResearchResult> {
    const place = findPlace(q.destination);
    const sample = place ? SAMPLES[place.iata] : undefined;
    if (!sample) {
      return {
        source: "mock",
        destination: q.destination,
        recommendations: [],
        note: "Live web research is not connected yet and there are no offline sample notes for this destination. Do not invent specific places, prices or opening hours; tell the traveller this part is unverified.",
      };
    }
    return {
      source: "mock",
      destination: place!.city,
      recommendations: sample.map((r) => ({ ...r, verified: false })),
      note: "Offline sample notes, not checked against a live source and without citations. Present them as unverified suggestions; do not state prices or opening hours.",
    };
  }
}
