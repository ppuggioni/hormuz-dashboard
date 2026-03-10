"use client";

import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";

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

function directionDegrees(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const dLon = to.lon - from.lon;
  const dLat = to.lat - from.lat;
  const rad = Math.atan2(dLon, dLat);
  return (rad * 180) / Math.PI;
}

function timestampShort(ts: string): string {
  const d = new Date(ts);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month} ${hour}:${min} UTC`;
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

  const selectedTrailWithDir = useMemo(() => {
    return selectedTrail.map((p, idx) => {
      const next = selectedTrail[idx + 1] || null;
      const prev = selectedTrail[idx - 1] || null;
      const dirRef = next || prev;
      const deg = dirRef
        ? directionDegrees(
            { lat: p.lat, lon: p.lon },
            next ? { lat: next.lat, lon: next.lon } : { lat: p.lat + (p.lat - prev!.lat), lon: p.lon + (p.lon - prev!.lon) },
          )
        : 0;
      return { ...p, dirDeg: deg };
    });
  }, [selectedTrail]);

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
      {selectedTrailWithDir.map((p, idx) => (
        <CircleMarker
          key={`trail-dot-${selectedShipId}-${idx}`}
          center={[p.lat, p.lon]}
          radius={1.6}
          pathOptions={{ color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.8, weight: 1 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} opacity={0.9} className="trail-ts-label">
            {timestampShort(p.t)}
          </Tooltip>
        </CircleMarker>
      ))}
      {selectedTrailWithDir.map((p, idx) => (
        <Marker
          key={`trail-arrow-${selectedShipId}-${idx}`}
          position={[p.lat, p.lon]}
          icon={divIcon({
            className: "",
            html: `<div style='transform: rotate(${p.dirDeg}deg); color:#9ca3af; font-size:11px; line-height:11px;'>▲</div>`,
            iconSize: [11, 11],
            iconAnchor: [5, 5],
          })}
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
