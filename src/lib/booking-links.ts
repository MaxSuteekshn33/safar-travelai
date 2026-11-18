import type { BookingLink } from "@/lib/types";
import { findPlace } from "@/lib/providers/mock/places";

export interface FlightLinkQuery {
  origin: string; // city or IATA
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children?: number;
}

export interface StayLinkQuery {
  city: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
}

/**
 * None of these sites has an API we may use, so we only build pre-filled
 * search URLs for the traveller to open. `verified` records whether the URL
 * pattern was opened in a browser and landed on the right search. Checked on
 * 18 Nov 2026 with a Delhi-Goa return for two adults; the patterns are
 * undocumented and can change, so re-check if a site redesigns.
 */
const VERIFIED = {
  skyscanner: true,
  makemytripFlights: true,
  ixigo: true,
  airbnb: true,
  /** Only the city-code form, used for Indian cities we know (checked on Goa and Jaipur). */
  makemytripHotels: true,
};

function iata(place: string): string | undefined {
  const p = findPlace(place);
  if (p) return p.iata;
  return /^[A-Za-z]{3}$/.test(place.trim()) ? place.trim().toUpperCase() : undefined;
}

const parts = (d: string) => ({ y: d.slice(0, 4), m: d.slice(5, 7), d: d.slice(8, 10) });

export function buildFlightLinks(q: FlightLinkQuery): { links: BookingLink[]; note?: string } {
  const from = iata(q.origin);
  const to = iata(q.destination);
  if (!from || !to) {
    return { links: [], note: "Could not work out airport codes for this route, so no flight links were built." };
  }
  const dep = parts(q.departDate);
  const ret = q.returnDate ? parts(q.returnDate) : undefined;
  const children = q.children ?? 0;
  const links: BookingLink[] = [];

  // Skyscanner: /transport/flights/{from}/{to}/{yymmdd}/{yymmdd}/
  const sky = new URL(
    `https://www.skyscanner.co.in/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${dep.y.slice(2)}${dep.m}${dep.d}/` +
      (ret ? `${ret.y.slice(2)}${ret.m}${ret.d}/` : ""),
  );
  sky.searchParams.set("adultsv2", String(q.adults));
  if (children) sky.searchParams.set("childrenv2", Array(children).fill("8").join("|"));
  sky.searchParams.set("cabinclass", "economy");
  links.push({ site: "Skyscanner", kind: "flights", url: sky.toString(), verified: VERIFIED.skyscanner });

  // MakeMyTrip: itinerary=DEL-GOI-20/12/2026_GOI-DEL-26/12/2026
  const mmtLeg = (a: string, b: string, p: { y: string; m: string; d: string }) => `${a}-${b}-${p.d}/${p.m}/${p.y}`;
  const mmt = new URL("https://www.makemytrip.com/flight/search");
  mmt.searchParams.set("itinerary", mmtLeg(from, to, dep) + (ret ? `_${mmtLeg(to, from, ret)}` : ""));
  mmt.searchParams.set("tripType", ret ? "R" : "O");
  mmt.searchParams.set("paxType", `A-${q.adults}_C-${children}_I-0`);
  mmt.searchParams.set("cabinClass", "E");
  links.push({ site: "MakeMyTrip", kind: "flights", url: mmt.toString(), verified: VERIFIED.makemytripFlights });

  // ixigo: date=ddmmyyyy
  const ix = new URL("https://www.ixigo.com/search/result/flight");
  ix.searchParams.set("from", from);
  ix.searchParams.set("to", to);
  ix.searchParams.set("date", `${dep.d}${dep.m}${dep.y}`);
  if (ret) ix.searchParams.set("returnDate", `${ret.d}${ret.m}${ret.y}`);
  ix.searchParams.set("adults", String(q.adults));
  ix.searchParams.set("children", String(children));
  ix.searchParams.set("infants", "0");
  ix.searchParams.set("class", "e");
  links.push({ site: "ixigo", kind: "flights", url: ix.toString(), verified: VERIFIED.ixigo });

  return { links };
}

export function buildStayLinks(q: StayLinkQuery): { links: BookingLink[] } {
  const city = findPlace(q.city)?.city ?? q.city.trim();
  const children = q.children ?? 0;
  const links: BookingLink[] = [];

  const air = new URL(`https://www.airbnb.co.in/s/${encodeURIComponent(city)}/homes`);
  air.searchParams.set("checkin", q.checkIn);
  air.searchParams.set("checkout", q.checkOut);
  air.searchParams.set("adults", String(q.adults));
  if (children) air.searchParams.set("children", String(children));
  links.push({ site: "Airbnb", kind: "stays", url: air.toString(), verified: VERIFIED.airbnb });

  // MakeMyTrip hotels needs its own city code ("CT" + airport code, e.g. CTGOI).
  // We only know that for Indian cities in our list; elsewhere we link to the
  // hotels page without a pre-filled search and say so.
  const place = findPlace(q.city);
  if (place && place.country === "India") {
    const ci = parts(q.checkIn);
    const co = parts(q.checkOut);
    const code = `CT${place.iata}`;
    const mmt = new URL("https://www.makemytrip.com/hotels/hotel-listing/");
    mmt.searchParams.set("checkin", `${ci.m}${ci.d}${ci.y}`);
    mmt.searchParams.set("checkout", `${co.m}${co.d}${co.y}`);
    mmt.searchParams.set("city", code);
    mmt.searchParams.set("country", "IN");
    mmt.searchParams.set("locusId", code);
    mmt.searchParams.set("locusType", "city");
    mmt.searchParams.set("roomStayQualifier", `${q.adults}e${children}e`);
    mmt.searchParams.set("searchText", place.city);
    links.push({ site: "MakeMyTrip", kind: "stays", url: mmt.toString(), verified: VERIFIED.makemytripHotels });
  } else {
    links.push({ site: "MakeMyTrip", kind: "stays", url: "https://www.makemytrip.com/hotels/", verified: false });
  }

  return { links };
}
