"use client";

import { Fragment, memo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";

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

type UsniTrajectoryPoint = {
  reportDate?: string | null;
  positionLabel: string;
  positionLat: number;
  positionLon: number;
  sourceUrl?: string | null;
  comments?: string | null;
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
      return "#ef4444";
    case "toward_arabian_sea":
      return "#facc15";
    case "exited_combat_zone":
      return "#22c55e";
    default:
      return "#020617";
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

function reportDateLabel(date?: string | null) {
  return date || "Unknown";
}

function popupGridTemplateRows(itemCount: number) {
  return `repeat(${Math.max(1, Math.min(itemCount, 4))}, minmax(0, auto))`;
}

function vesselChipStyle(direction: UsniMovementDirection | null | undefined, isSelected: boolean) {
  if (!direction) {
    return {
      border: isSelected ? "1px solid rgba(103,232,249,0.9)" : "1px solid rgba(203,213,225,0.85)",
      background: "#ffffff",
      color: "#0f172a",
    };
  }

  if (direction === "entered_combat_zone") {
    return {
      border: isSelected ? "1px solid rgba(103,232,249,0.9)" : "1px solid rgba(239,68,68,0.55)",
      background: "rgba(127,29,29,0.92)",
      color: "#fee2e2",
    };
  }

  if (direction === "toward_arabian_sea") {
    return {
      border: isSelected ? "1px solid rgba(103,232,249,0.9)" : "1px solid rgba(250,204,21,0.65)",
      background: "rgba(250,204,21,0.88)",
      color: "#1c1917",
    };
  }

  if (direction === "exited_combat_zone") {
    return {
      border: isSelected ? "1px solid rgba(103,232,249,0.9)" : "1px solid rgba(34,197,94,0.55)",
      background: "rgba(20,83,45,0.92)",
      color: "#dcfce7",
    };
  }

  return {
    border: isSelected ? "1px solid rgba(103,232,249,0.9)" : "1px solid rgba(15,23,42,0.92)",
    background: "#020617",
    color: "#f8fafc",
  };
}

export default memo(function UsniFleetMap({
  movements,
  locationGroups,
  selectedVesselKey,
  movementHighlightByVessel = {},
  selectedTrajectory = [],
  onSelectVessel,
}: {
  movements: UsniFleetMovementRow[];
  locationGroups: UsniLatestLocationGroup[];
  selectedVesselKey?: string | null;
  movementHighlightByVessel?: Record<string, UsniMovementDirection>;
  selectedTrajectory?: UsniTrajectoryPoint[];
  onSelectVessel?: (vesselKey: string) => void;
}) {
  const selectedTrajectoryPositions = selectedTrajectory.map((point) => [point.positionLat, point.positionLon] as [number, number]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer center={[24, 30]} zoom={2} preferCanvas style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {selectedTrajectoryPositions.length > 1 ? (
          <Polyline
            positions={selectedTrajectoryPositions}
            pathOptions={{
              color: "#cbd5e1",
              weight: 1.5,
              opacity: 0.75,
              dashArray: "4 5",
            }}
          />
        ) : null}

        {selectedTrajectory.map((point, index) => (
          <CircleMarker
            key={`selected-trajectory-${point.reportDate || "na"}-${point.positionLat}-${point.positionLon}-${index}`}
            center={[point.positionLat, point.positionLon]}
            radius={3}
            pathOptions={{ color: "#e2e8f0", fillColor: "#0f172a", fillOpacity: 0.95, weight: 1.5 }}
          >
            <Tooltip>
              {point.positionLabel} {point.reportDate ? `(${point.reportDate})` : ""}
            </Tooltip>
          </CircleMarker>
        ))}

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
                  weight: 2,
                  opacity: 0.88,
                }}
              />
              <Marker
                position={[current.lat, current.lon]}
                icon={getPlaybackTriangleIcon(color, heading, 11, false, false)}
              >
                <Tooltip>
                  {movement.vesselName}: {movement.previousPosition} to {movement.currentPosition}
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div><strong>{movement.vesselName}</strong></div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>{movement.vesselType}</div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{movementLabel(movement.direction)} on {movement.date}</div>
                    <div style={{ marginTop: 8, lineHeight: 1.45 }}>{movement.previousPosition} to {movement.currentPosition}</div>
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                      Details and source links are listed in the movement table below the map.
                    </div>
                  </div>
                </Popup>
              </Marker>
            </Fragment>
          );
        })}

        {locationGroups.map((group) => {
          const selectedVessel = selectedVesselKey
            ? group.vessels.find((vessel) => vessel.vesselKey === selectedVesselKey) || null
            : null;
          const containsSelected = Boolean(selectedVessel);
          const visibleVessels = selectedVessel ? [selectedVessel] : group.vessels;
          const count = group.vessels.length;
          const radius = Math.min(6 + (count * 1.4), 14);

          return (
            <CircleMarker
              key={`latest-group-${group.groupKey}`}
              center={[group.positionLat, group.positionLon]}
              radius={radius}
              pathOptions={{
                color: containsSelected ? "#67e8f9" : "#cbd5e1",
                fillColor: containsSelected ? "#164e63" : "#0f172a",
                fillOpacity: 0.92,
                weight: containsSelected ? 2.5 : 1.5,
              }}
            >
              <Tooltip>
                {group.positionLabel} - {count} vessel{count === 1 ? "" : "s"}
              </Tooltip>
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div><strong>{group.positionLabel}</strong></div>
                  <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75 }}>
                    {selectedVessel ? "Selected vessel" : `${count} vessel${count === 1 ? "" : "s"} at this location`}
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      display: "grid",
                      gap: 6,
                      gridTemplateRows: popupGridTemplateRows(visibleVessels.length),
                      gridAutoFlow: "column",
                      gridAutoColumns: "minmax(132px, 1fr)",
                      alignItems: "stretch",
                      minWidth: selectedVessel ? 170 : Math.min(620, Math.max(220, Math.ceil(visibleVessels.length / 4) * 140)),
                    }}
                  >
                    {visibleVessels.map((vessel) => {
                      const isSelected = vessel.vesselKey === selectedVesselKey;
                      const chipStyle = vesselChipStyle(movementHighlightByVessel[vessel.vesselKey], isSelected);
                      return (
                        <button
                          key={`latest-vessel-${vessel.vesselKey}`}
                          type="button"
                          onClick={() => onSelectVessel?.(vessel.vesselKey)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            borderRadius: 9,
                            border: chipStyle.border,
                            background: chipStyle.background,
                            color: chipStyle.color,
                            padding: "5px 7px",
                            cursor: "pointer",
                            boxShadow: isSelected ? "0 0 0 1px rgba(103,232,249,0.25) inset" : undefined,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.15 }}>{vessel.vesselName}</div>
                            <div style={{ fontSize: 9.5, opacity: 0.72, whiteSpace: "nowrap" }}>
                              {reportDateLabel(vessel.reportDate)}
                            </div>
                          </div>
                          <div style={{ marginTop: 1.5, fontSize: 9.5, opacity: 0.8, lineHeight: 1.15 }}>{vessel.vesselType}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {locationGroups.flatMap((group) => group.vessels
          .filter((vessel) => vessel.vesselKey === selectedVesselKey)
          .map((vessel) => (
            <CircleMarker
              key={`selected-current-${vessel.vesselKey}`}
              center={[vessel.positionLat, vessel.positionLon]}
              radius={6}
              pathOptions={{ color: "#67e8f9", fillColor: "#083344", fillOpacity: 0.95, weight: 2.5 }}
            >
              <Tooltip>
                Selected: {vessel.vesselName} - {vessel.positionLabel}
              </Tooltip>
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div><strong>{vessel.vesselName}</strong></div>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>{vessel.vesselType}</div>
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>Last update {reportDateLabel(vessel.reportDate)}</div>
                  <div style={{ marginTop: 8, lineHeight: 1.45 }}>{vessel.positionLabel}</div>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{formatLatLon(vessel.positionLat, vessel.positionLon)}</div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                    Full journey, comments, and source links are shown in the movement table below the map.
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          )))}
      </MapContainer>
    </div>
  );
});
