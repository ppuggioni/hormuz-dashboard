"use client";

import { CircleMarker, MapContainer, Popup, Polyline, TileLayer } from "react-leaflet";

type Point = { shipId: string; shipName: string; vesselType: string; lat: number; lon: number };
type LinkedPoint = { shipId: string; shipName: string; vesselType: string; region: string; lat: number; lon: number; deltaDh: string };

const typeColor: Record<string, string> = {
  tanker: "#f43f5e",
  cargo: "#22c55e",
  passenger: "#3b82f6",
  special: "#a78bfa",
  other: "#f59e0b",
  unknown: "#94a3b8",
};

function xAt(lat: number, lon: number, size = 0.045): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [lat - size, lon - size],
    [lat + size, lon + size],
    [lat - size, lon + size],
    [lat + size, lon - size],
  ];
}

export default function PlaybackMap({
  points,
  eastLon,
  westLon,
  crossingShipIds,
  showCrossing,
  showNonCrossing,
  linkedPoints,
}: {
  points: Point[];
  eastLon: number;
  westLon: number;
  crossingShipIds: Set<string>;
  showCrossing: boolean;
  showNonCrossing: boolean;
  linkedPoints?: LinkedPoint[];
}) {
  return (
    <MapContainer center={[26.15, 56.2]} zoom={7} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.2, eastLon], [27.3, eastLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />
      <Polyline positions={[[25.2, westLon], [27.3, westLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />

      {(linkedPoints || []).map((p, idx) => {
        const color = typeColor[p.vesselType] || '#e5e7eb';
        return (
        <CircleMarker
          key={`linked-${p.shipId}-${p.region}-${idx}`}
          center={[p.lat, p.lon]}
          radius={1}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 1 }}
        >
          <Popup>
            <div style={{ minWidth: 200 }}>
              <div><strong>Linked region:</strong> {p.region}</div>
              <div><strong>Ship:</strong> {p.shipName} ({p.shipId})</div>
              <div><strong>Transit time from Hormuz West:</strong> {p.deltaDh}</div>
              <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
            </div>
          </Popup>
        </CircleMarker>
      )})}

      {points.map((p) => {
        const color = typeColor[p.vesselType] || "#e5e7eb";
        const isCrosser = crossingShipIds.has(p.shipId);

        if (isCrosser) {
          if (!showCrossing) return null;
          const [a1, a2, b1, b2] = xAt(p.lat, p.lon);
          return (
            <>
              <Polyline key={`${p.shipId}-${p.lat}-${p.lon}-x1`} positions={[a1, a2]} pathOptions={{ color, weight: 3 }}>
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    <div><strong>Name:</strong> {p.shipName}</div>
                    <div><strong>Ship ID:</strong> {p.shipId}</div>
                    <div><strong>Type:</strong> {p.vesselType}</div>
                    <div><strong>Status:</strong> crossing vessel</div>
                    <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
                  </div>
                </Popup>
              </Polyline>
              <Polyline key={`${p.shipId}-${p.lat}-${p.lon}-x2`} positions={[b1, b2]} pathOptions={{ color, weight: 3 }} />
            </>
          );
        }

        if (!showNonCrossing) return null;
        return (
          <CircleMarker
            key={`${p.shipId}-${p.lat}-${p.lon}-dot`}
            center={[p.lat, p.lon]}
            radius={1}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 1 }}
          >
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div><strong>Name:</strong> {p.shipName}</div>
                <div><strong>Ship ID:</strong> {p.shipId}</div>
                <div><strong>Type:</strong> {p.vesselType}</div>
                <div><strong>Status:</strong> non-crossing</div>
                <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
