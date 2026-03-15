"use client";

import { Fragment, useMemo } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from "react-leaflet";

type PathPoint = { t: string; lat: number; lon: number };
type CrossingPath = {
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  primaryDirection: "east_to_west" | "west_to_east" | "mixed";
  directionCounts: { east_to_west: number; west_to_east: number };
  points: PathPoint[];
};
type LinkLine = {
  shipId: string;
  shipName: string;
  flag?: string;
  fromRegion: string;
  toRegion: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  deltaDh: string;
};

const shipPalette = [
  "#f43f5e",
  "#22c55e",
  "#3b82f6",
  "#a78bfa",
  "#f59e0b",
  "#14b8a6",
  "#eab308",
  "#ef4444",
  "#10b981",
  "#8b5cf6",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#ec4899",
  "#6366f1",
  "#2dd4bf",
];

function colorForShip(shipId: string): string {
  let hash = 0;
  for (let i = 0; i < shipId.length; i++) {
    hash = (hash * 31 + shipId.charCodeAt(i)) | 0;
  }
  return shipPalette[Math.abs(hash) % shipPalette.length];
}

function headingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}

function formatShipDisplayName(shipName: string, flag?: string | null) {
  const cleanName = String(shipName || "Unknown").trim() || "Unknown";
  const cleanFlag = String(flag || "").trim();
  return cleanFlag ? `${cleanName} [${cleanFlag}]` : cleanName;
}

function triangleIcon(color: string, deg: number, size = 11) {
  const h = Math.round(size * 1.15);
  const w = Math.round(size * 0.5);
  return divIcon({
    className: "",
    html: `<div style='transform: rotate(${deg}deg); width:0;height:0;border-left:${w / 2}px solid transparent;border-right:${w / 2}px solid transparent;border-bottom:${h}px solid ${color};'></div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), Math.round(h * 0.75)],
  });
}

function MapResetHandler({ onReset }: { onReset?: () => void }) {
  useMapEvents({
    click() {
      onReset?.();
    },
  });
  return null;
}

export default function CrossingPathsMap({
  paths,
  eastLon,
  westLon,
  linkLines,
  selectedShipIds,
  onToggleShip,
  onResetSelection,
}: {
  paths: CrossingPath[];
  eastLon: number;
  westLon: number;
  linkLines?: LinkLine[];
  selectedShipIds?: string[];
  onToggleShip?: (shipId: string) => void;
  onResetSelection?: () => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedShipIds || []), [selectedShipIds]);
  const hasSelection = selectedSet.size > 0;

  return (
    <MapContainer center={[26.1, 56.2]} zoom={6} style={{ height: "100%", width: "100%" }}>
      <MapResetHandler onReset={onResetSelection} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.4, eastLon], [27.1, eastLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />
      <Polyline positions={[[25.4, westLon], [27.1, westLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />

      {(linkLines || []).map((l, idx) => {
        const isSelected = selectedSet.has(l.shipId);
        const dimmed = hasSelection && !isSelected;
        return (
        <Polyline
          key={`linkline-${l.shipId}-${idx}`}
          positions={[[l.fromLat, l.fromLon], [l.toLat, l.toLon]]}
          pathOptions={{ color: dimmed ? '#475569' : '#94a3b8', weight: isSelected ? 1.8 : 1, opacity: dimmed ? 0.25 : 0.75, dashArray: '3 8' }}
          eventHandlers={{ click: () => onToggleShip?.(l.shipId) }}
        >
          <Popup>
            <div style={{ minWidth: 220 }}>
              <div><strong>Ship:</strong> {formatShipDisplayName(l.shipName, l.flag)} ({l.shipId})</div>
              <div><strong>Route:</strong> {l.fromRegion} → {l.toRegion}</div>
              <div><strong>Transit time from Hormuz West:</strong> {l.deltaDh}</div>
              <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${l.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
            </div>
          </Popup>
        </Polyline>
      )})}

      {paths.map((ship) => {
        const isSelected = selectedSet.has(ship.shipId);
        const dimmed = hasSelection && !isSelected;
        const color = dimmed ? "#64748b" : colorForShip(ship.shipId);
        const markerColor = dimmed ? "#94a3b8" : color;
        const markerSize = dimmed ? 5 : isSelected ? 11 : 9;
        const polyline = ship.points.map((p) => [p.lat, p.lon] as [number, number]);
        return (
          <Fragment key={ship.shipId}>
            <Polyline positions={polyline} pathOptions={{ color, weight: isSelected ? 2 : 1.2, opacity: dimmed ? 0.22 : 0.82, dashArray: "4 6" }} eventHandlers={{ click: () => onToggleShip?.(ship.shipId) }} />
            {ship.points.map((p, idx) => {
              let deg = 0;
              let found = false;
              for (let j = idx + 1; j < ship.points.length; j++) {
                const q = ship.points[j];
                const dist = Math.hypot(q.lat - p.lat, q.lon - p.lon);
                if (dist > 0.00005) {
                  deg = headingDeg({ lat: p.lat, lon: p.lon }, { lat: q.lat, lon: q.lon });
                  found = true;
                  break;
                }
              }
              if (!found) {
                for (let j = idx - 1; j >= 0; j--) {
                  const q = ship.points[j];
                  const dist = Math.hypot(p.lat - q.lat, p.lon - q.lon);
                  if (dist > 0.00005) {
                    deg = headingDeg({ lat: q.lat, lon: q.lon }, { lat: p.lat, lon: p.lon });
                    break;
                  }
                }
              }
              return (
              <Marker
                key={`${ship.shipId}-pt-${idx}`}
                position={[p.lat, p.lon]}
                icon={triangleIcon(markerColor, deg, markerSize)}
                eventHandlers={{ click: () => onToggleShip?.(ship.shipId) }}
              >
                <Tooltip>
                  {formatShipDisplayName(ship.shipName, ship.flag)} ({ship.shipId}) — {new Date(p.t).toUTCString()}
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div><strong>Name:</strong> {formatShipDisplayName(ship.shipName, ship.flag)}</div>
                    <div><strong>Ship ID:</strong> {ship.shipId}</div>
                    <div><strong>Type:</strong> {ship.vesselType}</div>
                    <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${ship.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                    <div><strong>Timestamp:</strong> {new Date(p.t).toUTCString()}</div>
                    <div><strong>Position:</strong> {p.lat.toFixed(4)}, {p.lon.toFixed(4)}</div>
                    <div><strong>Direction:</strong> {ship.primaryDirection.replace("_to_", " → ")}</div>
                    <div><strong>E→W:</strong> {ship.directionCounts.east_to_west} | <strong>W→E:</strong> {ship.directionCounts.west_to_east}</div>
                  </div>
                </Popup>
              </Marker>
            )})}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
