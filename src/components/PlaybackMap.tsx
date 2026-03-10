"use client";

import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, Polyline, TileLayer } from "react-leaflet";

type Point = { shipId: string; shipName: string; vesselType: string; lat: number; lon: number };
type Snapshot = { t: string; points: Point[] };
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
  snapshots,
  eastLon,
  westLon,
  crossingShipIds,
  showCrossing,
  showNonCrossing,
  linkedPoints,
}: {
  points: Point[];
  snapshots: Snapshot[];
  eastLon: number;
  westLon: number;
  crossingShipIds: Set<string>;
  showCrossing: boolean;
  showNonCrossing: boolean;
  linkedPoints?: LinkedPoint[];
}) {
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);

  const selectedTrail = useMemo(() => {
    if (!selectedShipId || !snapshots?.length) return [] as Array<{ t: string; lat: number; lon: number }>;

    const raw = snapshots
      .flatMap((s) => s.points
        .filter((p) => p.shipId === selectedShipId)
        .map((p) => ({ t: s.t, lat: p.lat, lon: p.lon })))
      .sort((a, b) => +new Date(a.t) - +new Date(b.t));

    if (raw.length <= 1500) return raw;
    const step = Math.ceil(raw.length / 1500);
    return raw.filter((_, i) => i % step === 0);
  }, [selectedShipId, snapshots]);

  const selectedShipMeta = useMemo(() => {
    if (!selectedShipId) return null;
    const hit = snapshots
      .flatMap((s) => s.points)
      .find((p) => p.shipId === selectedShipId);
    return hit || null;
  }, [selectedShipId, snapshots]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      {selectedShipMeta ? (
        <div
          style={{
            position: "absolute",
            zIndex: 900,
            top: 10,
            left: 10,
            background: "rgba(2, 6, 23, 0.86)",
            border: "1px solid rgba(148, 163, 184, 0.35)",
            borderRadius: 10,
            padding: "8px 10px",
            color: "#e2e8f0",
            fontSize: 12,
            lineHeight: 1.4,
            maxWidth: 320,
          }}
        >
          <div><strong>Name:</strong> {selectedShipMeta.shipName}</div>
          <div><strong>Ship ID:</strong> {selectedShipMeta.shipId}</div>
          <div><strong>Type:</strong> {selectedShipMeta.vesselType}</div>
          <div><strong>Window pings:</strong> {selectedTrail.length}</div>
        </div>
      ) : null}
      <MapContainer center={[26.15, 56.2]} zoom={7} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.2, eastLon], [27.3, eastLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />
      <Polyline positions={[[25.2, westLon], [27.3, westLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />

      {selectedTrail.length > 1 ? (
        <Polyline
          positions={selectedTrail.map((p) => [p.lat, p.lon] as [number, number])}
          pathOptions={{ color: "#9ca3af", weight: 1, opacity: 0.85, dashArray: "2 8" }}
        />
      ) : null}
      {selectedTrail.map((p, idx) => (
        <CircleMarker
          key={`trail-dot-${selectedShipId}-${idx}`}
          center={[p.lat, p.lon]}
          radius={1.6}
          pathOptions={{ color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.8, weight: 1 }}
        />
      ))}

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
              <Polyline
                key={`${p.shipId}-${p.lat}-${p.lon}-x1`}
                positions={[a1, a2]}
                pathOptions={{ color, weight: 3 }}
                eventHandlers={{ click: () => setSelectedShipId(p.shipId) }}
              >
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
              <Polyline
                key={`${p.shipId}-${p.lat}-${p.lon}-x2`}
                positions={[b1, b2]}
                pathOptions={{ color, weight: 3 }}
                eventHandlers={{ click: () => setSelectedShipId(p.shipId) }}
              />
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
            eventHandlers={{ click: () => setSelectedShipId(p.shipId) }}
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
    </div>
  );
}
