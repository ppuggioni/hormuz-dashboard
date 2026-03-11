"use client";

import { Fragment } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Polygon, Popup, Polyline, TileLayer, Tooltip } from "react-leaflet";

type PathPoint = { t: string; lat: number; lon: number };
type PortPath = {
  shipId: string;
  shipName: string;
  vesselType: string;
  points: PathPoint[];
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

function triangleIcon(color: string, deg: number, size = 10) {
  const h = Math.round(size * 1.15);
  const w = Math.round(size * 0.5);
  return divIcon({
    className: "",
    html: `<div style='transform: rotate(${deg}deg); width:0;height:0;border-left:${w / 2}px solid transparent;border-right:${w / 2}px solid transparent;border-bottom:${h}px solid ${color};'></div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), Math.round(h * 0.75)],
  });
}

export default function PortAreaPathsMap({
  paths,
  centerLat,
  centerLon,
  minLat,
  maxLat,
  minLon,
  maxLon,
  title,
  extraAreas,
}: {
  paths: PortPath[];
  centerLat: number;
  centerLon: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  title?: string;
  extraAreas?: { minLat: number; maxLat: number; minLon: number; maxLon: number; title?: string; color?: string }[];
}) {
  const bounds: [number, number][] = [
    [minLat, minLon],
    [minLat, maxLon],
    [maxLat, maxLon],
    [maxLat, minLon],
  ];

  return (
    <MapContainer center={[centerLat, centerLon]} zoom={9} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polygon positions={bounds} pathOptions={{ color: "#fbbf24", weight: 2, opacity: 0.95, fillColor: "#fbbf24", fillOpacity: 0.08 }}>
        <Popup>
          <div style={{ minWidth: 220 }}>
            <div><strong>{title || "Monitored area"}</strong></div>
            <div><strong>Center:</strong> {centerLat.toFixed(4)}, {centerLon.toFixed(4)}</div>
            <div><strong>Bounds:</strong></div>
            <div>Lat {minLat.toFixed(4)} to {maxLat.toFixed(4)}</div>
            <div>Lon {minLon.toFixed(4)} to {maxLon.toFixed(4)}</div>
          </div>
        </Popup>
      </Polygon>

      {(extraAreas || []).map((area, idx) => (
        <Polygon
          key={`extra-area-${idx}`}
          positions={[[area.minLat, area.minLon], [area.minLat, area.maxLon], [area.maxLat, area.maxLon], [area.maxLat, area.minLon]]}
          pathOptions={{ color: area.color || "#38bdf8", weight: 2, opacity: 0.95, fillColor: area.color || "#38bdf8", fillOpacity: 0.04 }}
        >
          <Popup>
            <div style={{ minWidth: 220 }}>
              <div><strong>{area.title || "Additional monitored area"}</strong></div>
              <div>Lat {area.minLat.toFixed(4)} to {area.maxLat.toFixed(4)}</div>
              <div>Lon {area.minLon.toFixed(4)} to {area.maxLon.toFixed(4)}</div>
            </div>
          </Popup>
        </Polygon>
      ))}

      {paths.map((ship) => {
        const color = colorForShip(ship.shipId);
        const polyline = ship.points.map((p) => [p.lat, p.lon] as [number, number]);
        return (
          <Fragment key={ship.shipId}>
            <Polyline positions={polyline} pathOptions={{ color, weight: 1.4, opacity: 0.85, dashArray: "4 6" }} />
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
                <Marker key={`${ship.shipId}-pt-${idx}`} position={[p.lat, p.lon]} icon={triangleIcon(color, deg, 9)}>
                  <Tooltip>
                    {ship.shipName} ({ship.shipId}) — {new Date(p.t).toUTCString()}
                  </Tooltip>
                  <Popup>
                    <div style={{ minWidth: 220 }}>
                      <div><strong>Name:</strong> {ship.shipName}</div>
                      <div><strong>Ship ID:</strong> {ship.shipId}</div>
                      <div><strong>Type:</strong> {ship.vesselType}</div>
                      <div><strong>Timestamp:</strong> {new Date(p.t).toUTCString()}</div>
                      <div><strong>Position:</strong> {p.lat.toFixed(4)}, {p.lon.toFixed(4)}</div>
                      <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${ship.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
