"use client";

import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer } from "react-leaflet";
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
  candidateShipIds,
  showCrossing,
  showNonCrossing,
  linkedPoints,
}: {
  points: Point[];
  snapshots: Snapshot[];
  eastLon: number;
  westLon: number;
  crossingShipIds: Set<string>;
  candidateShipIds?: Set<string>;
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

  const segmentArrows = useMemo(() => {
    if (selectedTrail.length < 2) return [] as Array<{ lat: number; lon: number; dirDeg: number }>;
    const out: Array<{ lat: number; lon: number; dirDeg: number }> = [];
    const fractions = [0.25, 0.5, 0.75];
    for (let i = 0; i < selectedTrail.length - 1; i++) {
      const a = selectedTrail[i];
      const b = selectedTrail[i + 1];
      const dirDeg = directionDegrees({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
      for (const f of fractions) {
        out.push({
          lat: a.lat + (b.lat - a.lat) * f,
          lon: a.lon + (b.lon - a.lon) * f,
          dirDeg,
        });
      }
    }
    return out;
  }, [selectedTrail]);

  const timestampLabelStep = useMemo(() => {
    const n = selectedTrailWithDir.length;
    if (n <= 40) return 1;
    if (n <= 90) return 2;
    if (n <= 180) return 3;
    if (n <= 320) return 5;
    if (n <= 600) return 8;
    return 12;
  }, [selectedTrailWithDir.length]);

  const labeledTrailPoints = useMemo(
    () => selectedTrailWithDir.filter((_, idx) => idx % timestampLabelStep === 0),
    [selectedTrailWithDir, timestampLabelStep],
  );

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
          <div style={{ marginTop: 4 }}>
            <a
              href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${selectedShipMeta.shipId}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#7dd3fc", textDecoration: "underline" }}
            >
              Open MarineTraffic
            </a>
          </div>
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
          pathOptions={{ color: "#9ca3af", weight: 2, opacity: 0.92, dashArray: "3 9" }}
        />
      ) : null}
      {selectedTrailWithDir.map((p, idx) => {
        const isFinal = idx === selectedTrailWithDir.length - 1;
        return (
          <Marker
            key={`trail-point-shape-${selectedShipId}-${idx}`}
            position={[p.lat, p.lon]}
            icon={divIcon({
              className: "",
              html: isFinal
                ? `<div style='width:10px;height:10px;background:#9ca3af;border:1px solid #e5e7eb;opacity:0.95;'></div>`
                : `<div style='transform: rotate(${p.dirDeg}deg); color:#6b7280; font-size:18px; line-height:18px; opacity:0.98;'>▲</div>`,
              iconSize: isFinal ? [10, 10] : [18, 18],
              iconAnchor: isFinal ? [5, 5] : [9, 9],
            })}
          />
        );
      })}
      {labeledTrailPoints.map((p, idx) => (
        <Polyline
          key={`trail-ts-line-${selectedShipId}-${idx}`}
          positions={[[p.lat, p.lon], [p.lat + 0.018, p.lon]]}
          pathOptions={{ color: "#6b7280", weight: 1.5, opacity: 0.95 }}
        />
      ))}
      {labeledTrailPoints.map((p, idx) => (
        <Marker
          key={`trail-ts-${selectedShipId}-${idx}`}
          position={[p.lat + 0.018, p.lon]}
          icon={divIcon({
            className: "",
            html: `<div style='color:#f1f5f9;font-size:11px;font-weight:600;text-shadow:0 1px 2px rgba(2,6,23,0.95);white-space:nowrap;transform:translate(-50%,-2px);'>${timestampShort(p.t)}</div>`,
            iconSize: [120, 14],
            iconAnchor: [60, 12],
          })}
        />
      ))}
      {segmentArrows.map((p, idx) => (
        <Marker
          key={`trail-arrow-seg-${selectedShipId}-${idx}`}
          position={[p.lat, p.lon]}
          icon={divIcon({
            className: "",
            html: `<div style='transform: rotate(${p.dirDeg - 90}deg); color:#6b7280; font-size:12px; line-height:12px; opacity:0.98;'>&gt;</div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
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
              <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${p.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
            </div>
          </Popup>
        </CircleMarker>
      )})}

      {points.map((p) => {
        const baseColor = typeColor[p.vesselType] || "#e5e7eb";
        const isCandidate = Boolean(candidateShipIds?.has(p.shipId));
        const color = isCandidate ? "#f59e0b" : baseColor;
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
                    <div><strong>Status:</strong> crossing vessel{isCandidate ? " (candidate dark crosser)" : ""}</div>
                    <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
                    <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${p.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
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
                <div><strong>Status:</strong> {isCandidate ? "candidate dark crosser" : "non-crossing"}</div>
                <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
                <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${p.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
    </div>
  );
}
