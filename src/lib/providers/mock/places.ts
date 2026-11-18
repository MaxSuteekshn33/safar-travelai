// A small gazetteer used by the mock providers. Coordinates are city centres
// or main airports, rounded; good enough for distance-based mock pricing.

export interface Place {
  city: string;
  iata: string;
  country: string;
  lat: number;
  lng: number;
  /** Rough cost-of-stay multiplier relative to an Indian metro. */
  costIndex: number;
  aliases?: string[];
  areas: string[];
}

export const PLACES: Place[] = [
  { city: "Delhi", iata: "DEL", country: "India", lat: 28.61, lng: 77.21, costIndex: 1.0, aliases: ["new delhi", "ncr"], areas: ["Connaught Place", "Aerocity", "Hauz Khas", "Karol Bagh"] },
  { city: "Mumbai", iata: "BOM", country: "India", lat: 19.08, lng: 72.88, costIndex: 1.2, aliases: ["bombay"], areas: ["Colaba", "Bandra West", "Juhu", "Andheri East"] },
  { city: "Bengaluru", iata: "BLR", country: "India", lat: 12.97, lng: 77.59, costIndex: 1.0, aliases: ["bangalore"], areas: ["Indiranagar", "MG Road", "Koramangala", "Whitefield"] },
  { city: "Chennai", iata: "MAA", country: "India", lat: 13.08, lng: 80.27, costIndex: 0.9, aliases: ["madras"], areas: ["T. Nagar", "Mylapore", "ECR", "Nungambakkam"] },
  { city: "Kolkata", iata: "CCU", country: "India", lat: 22.57, lng: 88.36, costIndex: 0.85, aliases: ["calcutta"], areas: ["Park Street", "Salt Lake", "Ballygunge", "New Town"] },
  { city: "Hyderabad", iata: "HYD", country: "India", lat: 17.39, lng: 78.49, costIndex: 0.9, areas: ["Banjara Hills", "HITEC City", "Gachibowli", "Charminar"] },
  { city: "Pune", iata: "PNQ", country: "India", lat: 18.52, lng: 73.86, costIndex: 0.85, areas: ["Koregaon Park", "Viman Nagar", "Baner", "Camp"] },
  { city: "Goa", iata: "GOI", country: "India", lat: 15.38, lng: 73.83, costIndex: 1.1, aliases: ["panaji", "panjim", "north goa", "south goa"], areas: ["Candolim", "Anjuna", "Panjim", "Palolem"] },
  { city: "Jaipur", iata: "JAI", country: "India", lat: 26.91, lng: 75.79, costIndex: 0.85, areas: ["C-Scheme", "Old City", "Amer Road", "Bani Park"] },
  { city: "Udaipur", iata: "UDR", country: "India", lat: 24.58, lng: 73.71, costIndex: 0.95, areas: ["Lake Pichola", "Fateh Sagar", "Hathi Pol", "Ambamata"] },
  { city: "Kochi", iata: "COK", country: "India", lat: 9.93, lng: 76.27, costIndex: 0.85, aliases: ["cochin", "kerala"], areas: ["Fort Kochi", "Marine Drive", "Ernakulam", "Willingdon Island"] },
  { city: "Srinagar", iata: "SXR", country: "India", lat: 34.08, lng: 74.8, costIndex: 0.9, aliases: ["kashmir"], areas: ["Dal Lake", "Boulevard Road", "Nigeen", "Rajbagh"] },
  { city: "Leh", iata: "IXL", country: "India", lat: 34.15, lng: 77.58, costIndex: 0.95, aliases: ["ladakh"], areas: ["Changspa", "Fort Road", "Upper Tukcha", "Main Bazaar"] },
  { city: "Varanasi", iata: "VNS", country: "India", lat: 25.32, lng: 82.97, costIndex: 0.75, aliases: ["banaras", "kashi"], areas: ["Assi Ghat", "Dashashwamedh", "Cantonment", "Sarnath"] },
  { city: "Dubai", iata: "DXB", country: "UAE", lat: 25.2, lng: 55.27, costIndex: 2.2, areas: ["Downtown", "Dubai Marina", "Deira", "Al Barsha"] },
  { city: "Singapore", iata: "SIN", country: "Singapore", lat: 1.35, lng: 103.82, costIndex: 2.6, areas: ["Marina Bay", "Orchard", "Little India", "Bugis"] },
  { city: "Bangkok", iata: "BKK", country: "Thailand", lat: 13.76, lng: 100.5, costIndex: 1.2, areas: ["Sukhumvit", "Silom", "Riverside", "Old Town"] },
  { city: "Phuket", iata: "HKT", country: "Thailand", lat: 7.88, lng: 98.39, costIndex: 1.3, areas: ["Patong", "Kata", "Karon", "Old Town"] },
  { city: "Bali", iata: "DPS", country: "Indonesia", lat: -8.65, lng: 115.22, costIndex: 1.2, aliases: ["denpasar"], areas: ["Ubud", "Seminyak", "Canggu", "Uluwatu"] },
  { city: "Kathmandu", iata: "KTM", country: "Nepal", lat: 27.72, lng: 85.32, costIndex: 0.8, areas: ["Thamel", "Lazimpat", "Boudha", "Patan"] },
  { city: "Colombo", iata: "CMB", country: "Sri Lanka", lat: 6.93, lng: 79.85, costIndex: 1.0, aliases: ["sri lanka"], areas: ["Fort", "Kollupitiya", "Mount Lavinia", "Cinnamon Gardens"] },
  { city: "Male", iata: "MLE", country: "Maldives", lat: 4.18, lng: 73.51, costIndex: 3.5, aliases: ["maldives", "malé"], areas: ["Hulhumale", "Maafushi", "North Male Atoll", "South Male Atoll"] },
  { city: "Kuala Lumpur", iata: "KUL", country: "Malaysia", lat: 3.14, lng: 101.69, costIndex: 1.3, areas: ["Bukit Bintang", "KLCC", "Chinatown", "Bangsar"] },
  { city: "Tokyo", iata: "NRT", country: "Japan", lat: 35.68, lng: 139.69, costIndex: 2.4, areas: ["Shinjuku", "Asakusa", "Shibuya", "Ginza"] },
  { city: "London", iata: "LHR", country: "UK", lat: 51.51, lng: -0.13, costIndex: 3.2, areas: ["Covent Garden", "Kensington", "Shoreditch", "Paddington"] },
  { city: "Paris", iata: "CDG", country: "France", lat: 48.86, lng: 2.35, costIndex: 3.0, areas: ["Le Marais", "Saint-Germain", "Montmartre", "Opéra"] },
  { city: "Istanbul", iata: "IST", country: "Türkiye", lat: 41.01, lng: 28.98, costIndex: 1.4, areas: ["Sultanahmet", "Beyoğlu", "Kadıköy", "Beşiktaş"] },
  { city: "New York", iata: "JFK", country: "USA", lat: 40.71, lng: -74.01, costIndex: 3.6, aliases: ["nyc"], areas: ["Midtown", "Lower East Side", "Brooklyn", "Upper West Side"] },
];

export function findPlace(query: string): Place | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    PLACES.find((p) => p.iata.toLowerCase() === q) ??
    PLACES.find((p) => p.city.toLowerCase() === q || p.aliases?.includes(q)) ??
    PLACES.find((p) => q.includes(p.city.toLowerCase()) || p.aliases?.some((a) => q.includes(a)))
  );
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Deterministic pseudo-random generator so the same search gives the same mock results. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Approximate INR value of one unit of each currency, for mock pricing only.
const INR_PER: Record<string, number> = { INR: 1, USD: 84, EUR: 91, GBP: 107, AED: 23, SGD: 63, THB: 2.4, JPY: 0.56 };

export function fromInr(amountInr: number, currency: string): number {
  const rate = INR_PER[currency.toUpperCase()] ?? 1;
  const v = amountInr / rate;
  return rate === 1 ? Math.round(v / 10) * 10 : Math.round(v);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(checkOut) - Date.parse(checkIn);
  return Math.round(ms / 86400000);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}
