"use client";

import { Fragment } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";

type PathPoint = { t: string; lat: number; lon: number };
type CrossingPath = {
  shipId: string;
  shipName: string;
  vesselType: string;
  primaryDirection: "east_to_west" | "west_to_east" | "mixed";
  directionCounts: { east_to_west: number; west_to_east: number };
  points: PathPoint[];
};

const typeColor: Record<string, string> = {
  tanker: "#f43f5e",
  cargo: "#22c55e",
  passenger: "#3b82f6",
  special: "#a78bfa",
  other: "#f59e0b",
  unknown: "#94a3b8",
};

export default function CrossingPathsMap({
  paths,
  eastLon,
  westLon,
}: {
  paths: CrossingPath[];
  eastLon: number;
  westLon: number;
}) {
  return (
    <MapContainer center={[26.1, 56.2]} zoom={9} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.4, eastLon], [27.1, eastLon]]} pathOptions={{ color: "#22d3ee", weight: 3, dashArray: "6" }} />
      <Polyline positions={[[25.4, westLon], [27.1, westLon]]} pathOptions={{ color: "#f97316", weight: 3, dashArray: "6" }} />

      {paths.map((ship) => {
        const color = typeColor[ship.vesselType] || "#e5e7eb";
        const polyline = ship.points.map((p) => [p.lat, p.lon] as [number, number]);
        return (
          <Fragment key={ship.shipId}>
            <Polyline positions={polyline} pathOptions={{ color, weight: 2.5, opacity: 0.9 }} />
            {ship.points.map((p, idx) => (
              <CircleMarker
                key={`${ship.shipId}-pt-${idx}`}
                center={[p.lat, p.lon]}
                radius={3}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 1 }}
              >
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div><strong>Name:</strong> {ship.shipName}</div>
                    <div><strong>Ship ID:</strong> {ship.shipId}</div>
                    <div><strong>Type:</strong> {ship.vesselType}</div>
                    <div><strong>Timestamp:</strong> {new Date(p.t).toUTCString()}</div>
                    <div><strong>Position:</strong> {p.lat.toFixed(4)}, {p.lon.toFixed(4)}</div>
                    <div><strong>Direction:</strong> {ship.primaryDirection.replace("_to_", " → ")}</div>
                    <div><strong>E→W:</strong> {ship.directionCounts.east_to_west} | <strong>W→E:</strong> {ship.directionCounts.west_to_east}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
