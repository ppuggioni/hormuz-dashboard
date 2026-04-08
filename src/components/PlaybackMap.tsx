"use client";

import { Fragment, memo, useMemo } from "react";
import { MapContainer, Marker, Popup, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";

import { getPlaybackTriangleIcon } from "@/lib/leafletIcons";
import { RED_SEA_REFERENCE_AREAS } from "@/lib/redSeaCrossingZones.mjs";

type Point = { shipId: string; shipName: string; vesselType: string; flag?: string; destination?: string; lat: number; lon: number };
type Snapshot = { t: string; points: Point[] };
type LinkedPoint = { shipId: string; shipName: string; vesselType: string; flag?: string; region: string; lat: number; lon: number; deltaDh: string };
type MonitoredArea = { minLat: number; maxLat: number; minLon: number; maxLon: number; color?: string; label?: string };
type TrailPoint = { t: string; lat: number; lon: number };
type SelectedShipTrace = {
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  destination?: string;
  traceSource: string;
  points: TrailPoint[];
};

const typeColor: Record<string, string> = {
  tanker: "#f43f5e",
  cargo: "#22c55e",
  passenger: "#3b82f6",
  special: "#a78bfa",
  other: "#f59e0b",
  unknown: "#94a3b8",
};
const selectedTracePalette = ["#38bdf8", "#f97316", "#a3e635", "#f472b6", "#facc15", "#34d399", "#c084fc", "#fb7185"];

function formatShipDisplayName(shipName: string, flag?: string | null) {
  const cleanName = String(shipName || "Unknown").trim() || "Unknown";
  const cleanFlag = String(flag || "").trim();
  return cleanFlag ? `${cleanName} [${cleanFlag}]` : cleanName;
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

function colorForSelectedTrace(shipId: string, vesselType: string, selectionCount: number): string {
  if (selectionCount <= 1) return typeColor[vesselType] || "#9ca3af";
  let hash = 0;
  for (let i = 0; i < shipId.length; i++) hash = ((hash << 5) - hash) + shipId.charCodeAt(i);
  return selectedTracePalette[Math.abs(hash) % selectedTracePalette.length];
}

export default memo(function PlaybackMap({
  points,
  snapshots,
  eastLon,
  westLon,
  crossingShipIds,
  candidateShipIds,
  showCrossing,
  showNonCrossing,
  linkedPoints,
  monitoredAreas,
  currentTimestamp,
  selectionMode,
  selectedShipIds,
  selectedShipTraces,
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
  monitoredAreas?: MonitoredArea[];
  currentTimestamp?: string;
  selectionMode?: boolean;
  selectedShipIds?: string[];
  selectedShipTraces?: SelectedShipTrace[];
}) {
  const snapshotIndexByTimestamp = useMemo(
    () => new Map(snapshots.map((snapshot, index) => [snapshot.t, index])),
    [snapshots],
  );
  const snapshotPointMaps = useMemo(
    () => snapshots.map((snapshot) => new Map(snapshot.points.map((point) => [point.shipId, point]))),
    [snapshots],
  );
  const selectedShipIdSet = useMemo(
    () => new Set(selectedShipIds || []),
    [selectedShipIds],
  );

  const currentFrameHeadingByShip = useMemo(() => {
    const m = new Map<string, { deg: number; lowMovement: boolean }>();
    const currentIndex = currentTimestamp ? (snapshotIndexByTimestamp.get(currentTimestamp) ?? -1) : -1;
    const currentByShip = new Map(points.map((p) => [p.shipId, p]));

    for (const [shipId, current] of currentByShip.entries()) {
      let prev: Point | null = null;
      let next: Point | null = null;

      for (let sIdx = currentIndex - 1; sIdx >= 0; sIdx--) {
        const hit = snapshotPointMaps[sIdx]?.get(shipId) || null;
        if (!hit) continue;
        prev = hit;
        if (Math.hypot(current.lat - hit.lat, current.lon - hit.lon) > 0.00005) break;
      }

      for (let sIdx = currentIndex + 1; sIdx < snapshots.length; sIdx++) {
        const hit = snapshotPointMaps[sIdx]?.get(shipId) || null;
        if (!hit) continue;
        next = hit;
        if (Math.hypot(current.lat - hit.lat, current.lon - hit.lon) > 0.00005) break;
      }

      const ref = prev && Math.hypot(current.lat - prev.lat, current.lon - prev.lon) > 0.00005 ? prev : next;
      if (!ref) {
        m.set(shipId, { deg: 0, lowMovement: true });
        continue;
      }

      const deg = ref === prev
        ? directionDegrees({ lat: prev!.lat, lon: prev!.lon }, { lat: current.lat, lon: current.lon })
        : directionDegrees({ lat: current.lat, lon: current.lon }, { lat: next!.lat, lon: next!.lon });
      const dist = Math.hypot(current.lat - ref.lat, current.lon - ref.lon);
      m.set(shipId, { deg, lowMovement: dist <= 0.01 });
    }

    return m;
  }, [points, snapshots, currentTimestamp, snapshotIndexByTimestamp, snapshotPointMaps]);

  const displayAreas = useMemo(
    () => [...(monitoredAreas || []), ...RED_SEA_REFERENCE_AREAS],
    [monitoredAreas],
  );

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer center={[26.15, 56.2]} zoom={6} preferCanvas style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.2, eastLon], [27.3, eastLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />
      <Polyline positions={[[25.2, westLon], [27.3, westLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />

      {displayAreas.map((area, idx) => (
        <Polygon
          key={`monitored-area-${idx}`}
          positions={[[area.minLat, area.minLon], [area.minLat, area.maxLon], [area.maxLat, area.maxLon], [area.maxLat, area.minLon]]}
          pathOptions={{ color: area.color || "#fbbf24", weight: 1.5, opacity: 0.8, fillColor: area.color || "#fbbf24", fillOpacity: area.color === "#d1d5db" ? 0.12 : 0.05 }}
        >
          {area.label ? (
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div><strong>{area.label}</strong></div>
                <div>Lat {area.minLat.toFixed(4)} to {area.maxLat.toFixed(4)}</div>
                <div>Lon {area.minLon.toFixed(4)} to {area.maxLon.toFixed(4)}</div>
              </div>
            </Popup>
          ) : null}
        </Polygon>
      ))}

      {(selectedShipTraces || []).map((trace) => {
        const color = colorForSelectedTrace(trace.shipId, trace.vesselType, (selectedShipTraces || []).length);
        const finalPoint = trace.points[trace.points.length - 1] || null;
        return (
          <Fragment key={`trace-${trace.shipId}`}>
            {trace.points.length > 1 ? (
              <Polyline
                positions={trace.points.map((point) => [point.lat, point.lon] as [number, number])}
                pathOptions={{ color, weight: 3, opacity: 0.88 }}
              />
            ) : null}
            {finalPoint ? (
              <Marker
                position={[finalPoint.lat, finalPoint.lon]}
                icon={divIcon({
                  className: "",
                  html: `<div style='width:12px;height:12px;border-radius:999px;background:${color};border:2px solid #e2e8f0;box-shadow:0 1px 4px rgba(2,6,23,0.8);'></div>`,
                  iconSize: [12, 12],
                  iconAnchor: [6, 6],
                })}
              >
                <Tooltip>
                  {formatShipDisplayName(trace.shipName, trace.flag)} ({trace.shipId})
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: 200 }}>
                    <div><strong>Name:</strong> {formatShipDisplayName(trace.shipName, trace.flag)}</div>
                    <div><strong>Ship ID:</strong> {trace.shipId}</div>
                    <div><strong>Type:</strong> {trace.vesselType}</div>
                    <div><strong>Trace points:</strong> {trace.points.length}</div>
                    <div><strong>Trace source:</strong> {trace.traceSource}</div>
                    {trace.destination ? <div><strong>Destination:</strong> {trace.destination}</div> : null}
                    <div><strong>Last trace point:</strong> {timestampShort(finalPoint.t)}</div>
                    <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${trace.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                  </div>
                </Popup>
              </Marker>
            ) : null}
          </Fragment>
        );
      })}

      {(linkedPoints || []).map((p, idx) => {
        const color = typeColor[p.vesselType] || '#e5e7eb';
        const heading = currentFrameHeadingByShip.get(p.shipId) || { deg: 0, lowMovement: true };
        return (
        <Marker
          key={`linked-${p.shipId}-${p.region}-${idx}`}
          position={[p.lat, p.lon]}
          icon={getPlaybackTriangleIcon(color, heading.deg, 12, false, heading.lowMovement)}
        >
          <Tooltip>
            {formatShipDisplayName(p.shipName, p.flag)} ({p.shipId}) — {p.region}
          </Tooltip>
          <Popup>
            <div style={{ minWidth: 200 }}>
              <div><strong>Linked region:</strong> {p.region}</div>
              <div><strong>Ship:</strong> {formatShipDisplayName(p.shipName, p.flag)} ({p.shipId})</div>
              <div><strong>Transit time from Hormuz West:</strong> {p.deltaDh}</div>
              <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
              <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${p.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
            </div>
          </Popup>
        </Marker>
      )})}

      {points.map((p) => {
        const baseColor = typeColor[p.vesselType] || "#e5e7eb";
        const isCandidate = Boolean(candidateShipIds?.has(p.shipId));
        const color = isCandidate ? "#f59e0b" : baseColor;
        const isCrosser = crossingShipIds.has(p.shipId);
        if (isCrosser && !showCrossing) return null;
        if (!isCrosser && !showNonCrossing) return null;

        const heading = currentFrameHeadingByShip.get(p.shipId) || { deg: 0, lowMovement: true };
        const isSelected = selectionMode && selectedShipIdSet.has(p.shipId);
        return (
          <Marker
            key={`${p.shipId}-${p.lat}-${p.lon}-tri`}
            position={[p.lat, p.lon]}
            icon={getPlaybackTriangleIcon(color, heading.deg, isSelected ? 10 : 8, isCrosser, heading.lowMovement)}
          >
            <Tooltip>
              {formatShipDisplayName(p.shipName, p.flag)} ({p.shipId}) — {isCrosser ? "crossing" : "non-crossing"}
            </Tooltip>
            <Popup>
              <div style={{ minWidth: 180 }}>
                <div><strong>Name:</strong> {formatShipDisplayName(p.shipName, p.flag)}</div>
                <div><strong>Ship ID:</strong> {p.shipId}</div>
                <div><strong>Type:</strong> {p.vesselType}</div>
                <div><strong>Status:</strong> {isCrosser ? `crossing vessel${isCandidate ? " (candidate dark crosser)" : ""}` : isCandidate ? "candidate dark crosser" : "non-crossing"}</div>
                <div><strong>Lat/Lon:</strong> {p.lat}, {p.lon}</div>
                <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${p.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
    </div>
  );
});
