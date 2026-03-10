"use client";

import { Fragment } from "react";
import { divIcon } from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";

type PathPoint = { t: string; lat: number; lon: number };
type Candidate = {
  shipId: string;
  shipName: string;
  points: PathPoint[];
  lastSeenAt: string;
  score: number;
};

export default function CandidatePathsMap({
  candidates,
  eastLon,
  westLon,
}: {
  candidates: Candidate[];
  eastLon: number;
  westLon: number;
}) {
  return (
    <MapContainer center={[26.1, 56.2]} zoom={8} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.4, eastLon], [27.1, eastLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />
      <Polyline positions={[[25.4, westLon], [27.1, westLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />

      {candidates.map((c) => {
        const polyline = c.points.map((p) => [p.lat, p.lon] as [number, number]);
        const last = c.points[c.points.length - 1];
        return (
          <Fragment key={`cand-${c.shipId}`}>
            <Polyline key={`cand-line-${c.shipId}`} positions={polyline} pathOptions={{ color: "#f59e0b", weight: 1.8, opacity: 0.85, dashArray: "4 8" }} />
            {c.points.map((p, idx) => (
              <CircleMarker
                key={`cand-pt-${c.shipId}-${idx}`}
                center={[p.lat, p.lon]}
                radius={2}
                pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.85, weight: 1 }}
              />
            ))}
            <Marker
              key={`cand-last-${c.shipId}`}
              position={[last.lat, last.lon]}
              icon={divIcon({
                className: "",
                html: `<div style='color:#f8fafc;font-size:11px;font-weight:600;text-shadow:0 1px 2px rgba(2,6,23,.95);white-space:nowrap;transform:translate(8px,-8px);'>disappeared: ${new Date(c.lastSeenAt).toUTCString()}</div>`,
                iconSize: [340, 14],
                iconAnchor: [0, 0],
              })}
            >
              <Popup>
                <div style={{ minWidth: 220 }}>
                  <div><strong>Ship:</strong> {c.shipName} ({c.shipId})</div>
                  <div><strong>Last seen:</strong> {new Date(c.lastSeenAt).toUTCString()}</div>
                  <div><strong>Candidate score:</strong> {c.score.toFixed(1)}</div>
                  <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                </div>
              </Popup>
            </Marker>
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
