"use client";

import { Fragment, memo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";

import { getPlaybackTriangleIcon } from "@/lib/leafletIcons";

type UsniMovementDirection =
  | "toward_arabian_sea"
  | "away_from_arabian_sea"
  | "entered_combat_zone"
  | "exited_combat_zone"
  | "repositioned"
  | "unchanged";

type UsniFleetMovementRow = {
  vesselKey: string;
  vesselName: string;
  vesselType: string;
  date: string;
  previousPosition: string;
  previousCoordinates: { lat: number; lon: number };
  currentPosition: string;
  currentCoordinates: { lat: number; lon: number };
  direction: UsniMovementDirection;
  comments: string;
  previousSourceUrl?: string | null;
  currentSourceUrl?: string | null;
};

type UsniTrackerSnapshotVessel = {
  vesselKey: string;
  vesselName: string;
  vesselType: string;
  hullNumber?: string | null;
  positionLabel: string;
  positionLat: number;
  positionLon: number;
  sourceUrl?: string | null;
  comments?: string | null;
};

type UsniLatestLocationGroup = {
  groupKey: string;
  positionLabel: string;
  positionLat: number;
  positionLon: number;
  vessels: Array<UsniTrackerSnapshotVessel & {
    reportDate?: string | null;
    evidenceSources?: string[];
    historyPointCount?: number;
  }>;
};

function formatLatLon(lat: number, lon: number) {
  const latSuffix = lat >= 0 ? "N" : "S";
  const lonSuffix = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}${latSuffix}, ${Math.abs(lon).toFixed(1)}${lonSuffix}`;
}

function directionDegrees(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const dLon = to.lon - from.lon;
  const dLat = to.lat - from.lat;
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}

function movementColor(direction: UsniMovementDirection) {
  switch (direction) {
    case "entered_combat_zone":
      return "#06b6d4";
    case "toward_arabian_sea":
      return "#22c55e";
    case "exited_combat_zone":
      return "#f59e0b";
    case "away_from_arabian_sea":
      return "#fb7185";
    case "unchanged":
      return "#94a3b8";
    default:
      return "#cbd5e1";
  }
}

function movementLabel(direction: UsniMovementDirection) {
  switch (direction) {
    case "entered_combat_zone":
      return "Entered combat zone";
    case "toward_arabian_sea":
      return "Toward Arabian Sea";
    case "exited_combat_zone":
      return "Exited combat zone";
    case "away_from_arabian_sea":
      return "Away from Arabian Sea";
    case "unchanged":
      return "Unchanged";
    default:
      return "Repositioned";
  }
}

export default memo(function UsniFleetMap({
  movements,
  locationGroups,
  selectedVesselKey,
  onSelectVessel,
}: {
  movements: UsniFleetMovementRow[];
  locationGroups: UsniLatestLocationGroup[];
  selectedVesselKey?: string | null;
  onSelectVessel?: (vesselKey: string) => void;
}) {
  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer center={[24, 30]} zoom={2} preferCanvas style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {movements.map((movement) => {
          const color = movementColor(movement.direction);
          const previous = movement.previousCoordinates;
          const current = movement.currentCoordinates;
          const heading = directionDegrees(previous, current);
          return (
            <Fragment key={`${movement.vesselKey}-${movement.date}-${movement.direction}`}>
              <Polyline
                positions={[
                  [previous.lat, previous.lon],
                  [current.lat, current.lon],
                ]}
                pathOptions={{
                  color,
                  weight: 3,
                  opacity: 0.88,
                  dashArray: movement.direction === "away_from_arabian_sea" || movement.direction === "exited_combat_zone" ? "8 6" : undefined,
                }}
              />
              <CircleMarker
                center={[previous.lat, previous.lon]}
                radius={5}
                pathOptions={{ color, fillColor: "#020617", fillOpacity: 0.95, weight: 2 }}
              >
                <Tooltip>
                  {movement.vesselName} previous: {movement.previousPosition}
                </Tooltip>
              </CircleMarker>
              <Marker
                position={[current.lat, current.lon]}
                icon={getPlaybackTriangleIcon(color, heading, 14, false, false)}
              >
                <Tooltip>
                  {movement.vesselName}: {movement.previousPosition} to {movement.currentPosition}
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: 230 }}>
                    <div><strong>{movement.vesselName}</strong></div>
                    <div><strong>Type:</strong> {movement.vesselType}</div>
                    <div><strong>Date:</strong> {movement.date}</div>
                    <div><strong>Direction:</strong> {movementLabel(movement.direction)}</div>
                    <div style={{ marginTop: 6 }}><strong>Previous:</strong> {movement.previousPosition}</div>
                    <div>{formatLatLon(previous.lat, previous.lon)}</div>
                    <div style={{ marginTop: 6 }}><strong>Current:</strong> {movement.currentPosition}</div>
                    <div>{formatLatLon(current.lat, current.lon)}</div>
                    <div style={{ marginTop: 8, lineHeight: 1.4 }}>{movement.comments}</div>
                    {movement.currentSourceUrl ? (
                      <div style={{ marginTop: 8 }}>
                        <a href={movement.currentSourceUrl} target="_blank" rel="noreferrer">Open source</a>
                      </div>
                    ) : null}
                  </div>
                </Popup>
              </Marker>
            </Fragment>
          );
        })}

        {locationGroups.map((group) => {
          const containsSelected = Boolean(selectedVesselKey && group.vessels.some((vessel) => vessel.vesselKey === selectedVesselKey));
          const count = group.vessels.length;
          const radius = Math.min(7 + (count * 1.8), 16);
          return (
          <CircleMarker
            key={`latest-group-${group.groupKey}`}
            center={[group.positionLat, group.positionLon]}
            radius={radius}
            pathOptions={{
              color: containsSelected ? "#67e8f9" : "#cbd5e1",
              fillColor: containsSelected ? "#164e63" : "#0f172a",
              fillOpacity: 0.92,
              weight: containsSelected ? 3 : 2,
            }}
          >
            <Tooltip>
              {group.positionLabel} — {count} vessel{count === 1 ? "" : "s"}
            </Tooltip>
            <Popup>
              <div style={{ minWidth: 250 }}>
                <div><strong>{group.positionLabel}</strong></div>
                <div>{formatLatLon(group.positionLat, group.positionLon)}</div>
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  {count} vessel{count === 1 ? "" : "s"} at this latest tracked location
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {group.vessels.map((vessel) => {
                    const isSelected = vessel.vesselKey === selectedVesselKey;
                    return (
                      <button
                        key={`latest-vessel-${vessel.vesselKey}`}
                        type="button"
                        onClick={() => onSelectVessel?.(vessel.vesselKey)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          borderRadius: 10,
                          border: isSelected ? "1px solid rgba(103,232,249,0.7)" : "1px solid rgba(148,163,184,0.35)",
                          background: isSelected ? "rgba(6,182,212,0.12)" : "rgba(15,23,42,0.92)",
                          color: "#e2e8f0",
                          padding: "8px 10px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{vessel.vesselName}</div>
                        <div style={{ marginTop: 2, fontSize: 12, opacity: 0.85 }}>
                          {vessel.hullNumber ? `${vessel.hullNumber} · ` : ""}{vessel.vesselType}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                          Latest report: {vessel.reportDate || "unknown"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Popup>
          </CircleMarker>
          );
        })}

        {locationGroups.flatMap((group) => group.vessels.filter((vessel) => vessel.vesselKey === selectedVesselKey).map((vessel) => (
          <CircleMarker
            key={`selected-current-${vessel.vesselKey}`}
            center={[vessel.positionLat, vessel.positionLon]}
            radius={7}
            pathOptions={{ color: "#67e8f9", fillColor: "#083344", fillOpacity: 0.95, weight: 3 }}
          >
            <Tooltip>
              Selected: {vessel.vesselName} — {vessel.positionLabel}
            </Tooltip>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div><strong>{vessel.vesselName}</strong>{vessel.hullNumber ? ` (${vessel.hullNumber})` : ""}</div>
                <div><strong>Type:</strong> {vessel.vesselType}</div>
                <div><strong>Current tracked position:</strong> {vessel.positionLabel}</div>
                <div><strong>Coordinates:</strong> {formatLatLon(vessel.positionLat, vessel.positionLon)}</div>
                {vessel.reportDate ? <div style={{ marginTop: 6 }}><strong>Latest report:</strong> {vessel.reportDate}</div> : null}
                {vessel.sourceUrl ? (
                  <div style={{ marginTop: 8 }}>
                    <a href={vessel.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
                  </div>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        )))}

        <Marker
          position={[17.5, 65.5]}
          icon={divIcon({
            className: "",
            html: "<div style='width:12px;height:12px;border-radius:999px;background:#f8fafc;border:2px solid #020617;box-shadow:0 1px 4px rgba(2,6,23,0.8);'></div>",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          })}
        >
          <Tooltip>Arabian Sea reference point</Tooltip>
        </Marker>
      </MapContainer>
    </div>
  );
});
