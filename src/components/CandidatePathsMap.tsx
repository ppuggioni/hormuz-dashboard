"use client";

import { Fragment, useMemo, useState } from "react";
import { divIcon } from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";

type PathPoint = { t: string; lat: number; lon: number };
type Candidate = {
  shipId: string;
  shipName: string;
  points: PathPoint[];
  lastSeenAt: string;
  score: number;
  approachScore: number;
  proximityScore: number;
  directionScore: number;
  darknessScore: number;
  alignedPoints: number;
  speedQuality: number;
  approachConfidence: number;
  proximityRaw: number;
  approachDirectionRaw: number;
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
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);

  const selected = useMemo(
    () => (selectedShipId ? candidates.find((c) => c.shipId === selectedShipId) || null : null),
    [candidates, selectedShipId],
  );

  return (
    <MapContainer center={[26.1, 56.2]} zoom={6} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={[[25.4, eastLon], [27.1, eastLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />
      <Polyline positions={[[25.4, westLon], [27.1, westLon]]} pathOptions={{ color: "#cbd5e1", weight: 1, dashArray: "4 6" }} />

      {candidates.map((c) => {
        const polyline = c.points.map((p) => [p.lat, p.lon] as [number, number]);
        const last = c.points[c.points.length - 1];
        const isSelected = selectedShipId === c.shipId;
        const baseColor = isSelected ? "#000000" : "#f59e0b";

        return (
          <Fragment key={`cand-${c.shipId}`}>
            <Polyline
              key={`cand-line-${c.shipId}`}
              positions={polyline}
              pathOptions={{ color: baseColor, weight: isSelected ? 3.2 : 1.8, opacity: isSelected ? 0.98 : 0.75, dashArray: isSelected ? "" : "4 8" }}
              eventHandlers={{ click: () => setSelectedShipId(c.shipId) }}
            />
            {c.points.map((p, idx) => (
              <CircleMarker
                key={`cand-pt-${c.shipId}-${idx}`}
                center={[p.lat, p.lon]}
                radius={isSelected ? 2.7 : 2}
                pathOptions={{ color: baseColor, fillColor: baseColor, fillOpacity: isSelected ? 0.95 : 0.8, weight: 1 }}
                eventHandlers={{ click: () => setSelectedShipId(c.shipId) }}
              />
            ))}
            <Marker
              key={`cand-last-${c.shipId}`}
              position={[last.lat, last.lon]}
              eventHandlers={{ click: () => setSelectedShipId(c.shipId) }}
              icon={divIcon({
                className: "",
                html: `<div style='color:${isSelected ? "#111827" : "#f8fafc"};font-size:11px;font-weight:700;text-shadow:0 1px 2px rgba(2,6,23,.95);white-space:nowrap;transform:translate(8px,-8px);'>disappeared: ${new Date(c.lastSeenAt).toUTCString()} | score: ${c.score.toFixed(1)}</div>`,
                iconSize: [520, 14],
                iconAnchor: [0, 0],
              })}
            >
              <Popup>
                <div style={{ minWidth: 260 }}>
                  <div><strong>Ship:</strong> {c.shipName} ({c.shipId})</div>
                  <div><strong>Last seen:</strong> {new Date(c.lastSeenAt).toUTCString()}</div>
                  <div><strong>Candidate score:</strong> {c.score.toFixed(1)}</div>
                  <div style={{ marginTop: 8 }}><strong>Score components</strong></div>
                  <div>Approach score: {c.approachScore.toFixed(1)}</div>
                  <div>Proximity score: {c.proximityScore.toFixed(1)}</div>
                  <div>Direction score: {c.directionScore.toFixed(1)}</div>
                  <div>Darkness score: {c.darknessScore.toFixed(1)}</div>
                  <div style={{ marginTop: 6 }}><strong>Sub-parameters</strong></div>
                  <div>Aligned points: {c.alignedPoints}</div>
                  <div>Speed quality: {c.speedQuality.toFixed(2)}</div>
                  <div>Approach confidence: {c.approachConfidence.toFixed(2)}</div>
                  <div>Proximity raw: {c.proximityRaw.toFixed(2)}</div>
                  <div>Direction raw: {c.approachDirectionRaw.toFixed(2)}</div>
                  <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                </div>
              </Popup>
            </Marker>
          </Fragment>
        );
      })}

      {selected ? (
        <Marker
          position={[selected.points[selected.points.length - 1].lat, selected.points[selected.points.length - 1].lon]}
          icon={divIcon({
            className: "",
            html: `<div style='background:rgba(2,6,23,0.88);border:1px solid #475569;border-radius:8px;padding:6px 8px;color:#e2e8f0;font-size:11px;white-space:nowrap;'>Selected: ${selected.shipName} (${selected.shipId})</div>`,
            iconSize: [260, 26],
            iconAnchor: [0, 30],
          })}
        />
      ) : null}
    </MapContainer>
  );
}
