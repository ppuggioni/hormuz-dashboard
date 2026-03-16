"use client";

import { Fragment, memo, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from "react-leaflet";

import { getTriangleIcon } from "@/lib/leafletIcons";

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

const DETAIL_MARKER_LIMIT = 240;

function buildDetailPoints(points: PathPoint[], limit = DETAIL_MARKER_LIMIT) {
  if (points.length <= limit) return points;

  const sampled: PathPoint[] = [];
  const seen = new Set<number>();
  const lastIndex = points.length - 1;
  const step = lastIndex / Math.max(limit - 1, 1);

  for (let i = 0; i < limit; i++) {
    const idx = Math.round(i * step);
    if (seen.has(idx)) continue;
    seen.add(idx);
    sampled.push(points[idx]);
  }

  if (!seen.has(lastIndex)) sampled.push(points[lastIndex]);
  return sampled;
}

function headingForPoint(points: PathPoint[], idx: number) {
  const point = points[idx];
  for (let j = idx + 1; j < points.length; j++) {
    const next = points[j];
    const dist = Math.hypot(next.lat - point.lat, next.lon - point.lon);
    if (dist > 0.00005) {
      return headingDeg({ lat: point.lat, lon: point.lon }, { lat: next.lat, lon: next.lon });
    }
  }
  for (let j = idx - 1; j >= 0; j--) {
    const prev = points[j];
    const dist = Math.hypot(point.lat - prev.lat, point.lon - prev.lon);
    if (dist > 0.00005) {
      return headingDeg({ lat: prev.lat, lon: prev.lon }, { lat: point.lat, lon: point.lon });
    }
  }
  return 0;
}

function MapResetHandler({ onReset }: { onReset?: () => void }) {
  useMapEvents({
    click() {
      onReset?.();
    },
  });
  return null;
}

export default memo(function CrossingPathsMap({
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
  const detailShipId = selectedSet.size === 1 ? selectedShipIds?.[0] || null : null;

  return (
    <MapContainer center={[26.1, 56.2]} zoom={6} preferCanvas style={{ height: "100%", width: "100%" }}>
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
        const isDetailed = detailShipId === ship.shipId;
        const color = dimmed ? "#64748b" : colorForShip(ship.shipId);
        const markerColor = dimmed ? "#94a3b8" : color;
        const markerSize = dimmed ? 5 : 10;
        const polyline = ship.points.map((p) => [p.lat, p.lon] as [number, number]);
        const lastPoint = ship.points[ship.points.length - 1];
        const detailPoints = isDetailed ? buildDetailPoints(ship.points) : [];

        if (!lastPoint) return null;

        return (
          <Fragment key={ship.shipId}>
            <Polyline positions={polyline} pathOptions={{ color, weight: isSelected ? 2 : 1.2, opacity: dimmed ? 0.22 : 0.82, dashArray: "4 6" }} eventHandlers={{ click: () => onToggleShip?.(ship.shipId) }} />
            {!isDetailed ? (
              <CircleMarker
                center={[lastPoint.lat, lastPoint.lon]}
                radius={isSelected ? 4 : 3}
                pathOptions={{
                  color: markerColor,
                  fillColor: markerColor,
                  fillOpacity: dimmed ? 0.35 : 0.85,
                  opacity: dimmed ? 0.4 : 0.95,
                  weight: 1,
                }}
                eventHandlers={{ click: () => onToggleShip?.(ship.shipId) }}
              >
                <Tooltip>
                  {formatShipDisplayName(ship.shipName, ship.flag)} ({ship.shipId}) — latest point
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div><strong>Name:</strong> {formatShipDisplayName(ship.shipName, ship.flag)}</div>
                    <div><strong>Ship ID:</strong> {ship.shipId}</div>
                    <div><strong>Type:</strong> {ship.vesselType}</div>
                    <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${ship.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                    <div><strong>Last point:</strong> {new Date(lastPoint.t).toUTCString()}</div>
                    <div><strong>Position:</strong> {lastPoint.lat.toFixed(4)}, {lastPoint.lon.toFixed(4)}</div>
                    <div><strong>Direction:</strong> {ship.primaryDirection.replace("_to_", " → ")}</div>
                    <div><strong>E→W:</strong> {ship.directionCounts.east_to_west} | <strong>W→E:</strong> {ship.directionCounts.west_to_east}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ) : null}
            {isDetailed ? detailPoints.map((p, idx) => (
              <Marker
                key={`${ship.shipId}-pt-${idx}`}
                position={[p.lat, p.lon]}
                icon={getTriangleIcon(markerColor, headingForPoint(detailPoints, idx), markerSize)}
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
            )) : null}
          </Fragment>
        );
      })}
    </MapContainer>
  );
});
