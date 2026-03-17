"use client";

import { DomEvent } from "leaflet";
import { Fragment, memo, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, Rectangle, TileLayer, Tooltip, useMapEvents } from "react-leaflet";

import { RED_SEA_REFERENCE_AREAS } from "@/lib/redSeaCrossingZones.mjs";

type RedSeaCrossingType = "south_outbound" | "south_inbound" | "north_outbound" | "north_inbound";
type PathPoint = { t: string; lat: number; lon: number; sourceRegion?: string; zones?: string[] };
type RedSeaCrossingRoute = {
  eventId: string;
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  crossingType: RedSeaCrossingType;
  t: string;
  crossingTime: string;
  priorTime: string;
  priorZone: string;
  priorLat: number;
  priorLon: number;
  anchorZone: string;
  anchorTime: string;
  anchorLat: number;
  anchorLon: number;
  points: PathPoint[];
};

const crossingTypeColor: Record<RedSeaCrossingType, string> = {
  south_outbound: "#f97316",
  south_inbound: "#22c55e",
  north_outbound: "#38bdf8",
  north_inbound: "#eab308",
};

function formatShipDisplayName(shipName: string, flag?: string | null) {
  const cleanName = String(shipName || "Unknown").trim() || "Unknown";
  const cleanFlag = String(flag || "").trim();
  return cleanFlag ? `${cleanName} [${cleanFlag}]` : cleanName;
}

function formatCrossingType(crossingType: RedSeaCrossingType) {
  return crossingType.replace(/_/g, " ");
}

function splitPointsByGap(points: PathPoint[], maxGapHours = 18) {
  if (points.length <= 1) return points.length ? [points] : [];
  const segments: PathPoint[][] = [];
  let currentSegment: PathPoint[] = [points[0]];

  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const next = points[index];
    const gapHours = (+new Date(next.t) - +new Date(prev.t)) / 36e5;
    if (gapHours > maxGapHours) {
      if (currentSegment.length) segments.push(currentSegment);
      currentSegment = [next];
      continue;
    }
    currentSegment.push(next);
  }

  if (currentSegment.length) segments.push(currentSegment);
  return segments;
}

function buildDetailPoints(points: PathPoint[], limit = 80) {
  if (points.length <= limit) return points;
  const selected: PathPoint[] = [];
  const step = (points.length - 1) / Math.max(limit - 1, 1);
  const seen = new Set<number>();

  for (let index = 0; index < limit; index++) {
    const pointIndex = Math.round(index * step);
    if (seen.has(pointIndex)) continue;
    seen.add(pointIndex);
    selected.push(points[pointIndex]);
  }

  return selected;
}

function MapResetHandler({ onReset }: { onReset?: () => void }) {
  useMapEvents({
    click() {
      onReset?.();
    },
  });
  return null;
}

export default memo(function RedSeaCrossingMap({
  routes,
  selectedEventIds,
  onToggleEvent,
  onResetSelection,
}: {
  routes: RedSeaCrossingRoute[];
  selectedEventIds?: string[];
  onToggleEvent?: (eventId: string) => void;
  onResetSelection?: () => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedEventIds || []), [selectedEventIds]);
  const hasSelection = selectedSet.size > 0;
  const detailEventId = selectedSet.size === 1 ? selectedEventIds?.[0] || null : null;
  const buildToggleHandler = (eventId: string) => ({
    click(event: { originalEvent?: Event }) {
      if (event?.originalEvent) DomEvent.stopPropagation(event.originalEvent);
      onToggleEvent?.(eventId);
    },
  });

  return (
    <MapContainer center={[21.5, 38.5]} zoom={5} preferCanvas style={{ height: "100%", width: "100%" }}>
      <MapResetHandler onReset={onResetSelection} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {RED_SEA_REFERENCE_AREAS.map((zone) => (
        <Rectangle
          key={zone.label}
          bounds={[[zone.minLat, zone.minLon], [zone.maxLat, zone.maxLon]]}
          pathOptions={{ color: zone.color || "#cbd5e1", weight: 1, opacity: 0.8, dashArray: "4 6", fillOpacity: 0.03 }}
        >
          <Tooltip sticky>{zone.label}</Tooltip>
        </Rectangle>
      ))}

      {routes.map((route) => {
        const isSelected = selectedSet.has(route.eventId);
        const dimmed = hasSelection && !isSelected;
        const color = dimmed ? "#475569" : crossingTypeColor[route.crossingType];
        const segments = splitPointsByGap(route.points);
        const detailPoints = detailEventId === route.eventId ? buildDetailPoints(route.points) : [];

        return (
          <Fragment key={route.eventId}>
            {segments.map((segment, index) => (
              <Polyline
                key={`${route.eventId}-segment-${index}`}
                positions={segment.map((point) => [point.lat, point.lon] as [number, number])}
                pathOptions={{ color, weight: isSelected ? 2.8 : 1.8, opacity: dimmed ? 0.18 : 0.82 }}
                eventHandlers={buildToggleHandler(route.eventId)}
              />
            ))}

            <CircleMarker
              center={[route.priorLat, route.priorLon]}
              radius={isSelected ? 5 : 4}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: dimmed ? 0.2 : 0.85,
                opacity: dimmed ? 0.3 : 0.95,
                weight: 1,
              }}
              eventHandlers={buildToggleHandler(route.eventId)}
            >
              <Tooltip>{formatShipDisplayName(route.shipName, route.flag)} — prior hit</Tooltip>
              <Popup>
                <div style={{ minWidth: 240 }}>
                  <div><strong>Name:</strong> {formatShipDisplayName(route.shipName, route.flag)}</div>
                  <div><strong>Ship ID:</strong> {route.shipId}</div>
                  <div><strong>Crossing:</strong> {formatCrossingType(route.crossingType)}</div>
                  <div><strong>Prior zone:</strong> {route.priorZone}</div>
                  <div><strong>Prior time:</strong> {new Date(route.priorTime).toUTCString()}</div>
                  <div><strong>Position:</strong> {route.priorLat.toFixed(4)}, {route.priorLon.toFixed(4)}</div>
                  <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${route.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                </div>
              </Popup>
            </CircleMarker>

            <CircleMarker
              center={[route.anchorLat, route.anchorLon]}
              radius={isSelected ? 6 : 5}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: dimmed ? 0.2 : 0.95,
                opacity: dimmed ? 0.3 : 1,
                weight: 2,
              }}
              eventHandlers={buildToggleHandler(route.eventId)}
            >
              <Tooltip>{formatShipDisplayName(route.shipName, route.flag)} — anchor hit</Tooltip>
              <Popup>
                <div style={{ minWidth: 240 }}>
                  <div><strong>Name:</strong> {formatShipDisplayName(route.shipName, route.flag)}</div>
                  <div><strong>Ship ID:</strong> {route.shipId}</div>
                  <div><strong>Type:</strong> {route.vesselType}</div>
                  <div><strong>Crossing:</strong> {formatCrossingType(route.crossingType)}</div>
                  <div><strong>Anchor zone:</strong> {route.anchorZone}</div>
                  <div><strong>Crossing time:</strong> {new Date(route.crossingTime).toUTCString()}</div>
                  <div><strong>Position:</strong> {route.anchorLat.toFixed(4)}, {route.anchorLon.toFixed(4)}</div>
                  <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${route.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                </div>
              </Popup>
            </CircleMarker>

            {detailEventId === route.eventId ? detailPoints.map((point, index) => (
              <CircleMarker
                key={`${route.eventId}-detail-${index}`}
                center={[point.lat, point.lon]}
                radius={2.5}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.75,
                  opacity: 0.85,
                  weight: 1,
                }}
                eventHandlers={buildToggleHandler(route.eventId)}
              >
                <Tooltip>{new Date(point.t).toUTCString()}</Tooltip>
              </CircleMarker>
            )) : null}
          </Fragment>
        );
      })}
    </MapContainer>
  );
});
