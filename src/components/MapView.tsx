"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface MapStop {
  label: string; // shown on the pin: day number or "H" for a stay
  title: string;
  lat: number;
  lng: number;
  kind: "stop" | "stay";
}

/** OpenStreetMap map of the itinerary stops. Leaflet is loaded in the browser only. */
export function MapView({ stops }: { stops: MapStop[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { scrollWheelZoom: false }).setView([22, 79], 4);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const map = mapRef.current;
      const layer = layerRef.current!;
      layer.clearLayers();
      const points: [number, number][] = [];
      for (const s of stops) {
        points.push([s.lat, s.lng]);
        const label = document.createElement("span");
        label.textContent = s.title; // textContent, never HTML: titles come from the model
        L.marker([s.lat, s.lng], {
          title: s.title,
          icon: L.divIcon({
            className: "",
            html: `<div class="stop-pin${s.kind === "stay" ? " stay" : ""}">${s.label.replace(/[^\w]/g, "")}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        })
          .bindPopup(label)
          .addTo(layer);
      }
      if (points.length === 1) map.setView(points[0], 12);
      else if (points.length > 1) map.fitBounds(points, { padding: [28, 28], maxZoom: 14 });
      map.invalidateSize();
    });
    return () => {
      cancelled = true;
    };
  }, [stops]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return <div ref={ref} className="h-64 w-full overflow-hidden rounded-xl border border-line" aria-label="Map of stops" />;
}
