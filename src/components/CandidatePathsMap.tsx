"use client";

import { Fragment, useMemo } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";

const vesselPalette = ["#f59e0b", "#22c55e", "#38bdf8", "#e879f9", "#f43f5e", "#a3e635", "#2dd4bf", "#f97316", "#60a5fa", "#fb7185"];
function colorForShip(shipId: string) {
  let hash = 0;
  for (let i = 0; i < shipId.length; i++) hash = (hash * 31 + shipId.charCodeAt(i)) | 0;
  return vesselPalette[Math.abs(hash) % vesselPalette.length];
}
function scoreToYellowGreen(score: number) {
  const t = Math.max(0, Math.min(1, (score - 30) / 20));
  const r = Math.round(245 + (34 - 245) * t);
  const g = Math.round(158 + (197 - 158) * t);
  const b = Math.round(11 + (94 - 11) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function headingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}

function triangleIcon(color: string, deg: number, size = 10) {
  const h = Math.round(size * 1.15);
  const w = Math.round(size * 0.7);
  return divIcon({
    className: "",
    html: `<div style='transform: rotate(${deg}deg); width:0;height:0;border-left:${w / 2}px solid transparent;border-right:${w / 2}px solid transparent;border-bottom:${h}px solid ${color};'></div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), Math.round(h * 0.75)],
  });
}

type PathPoint = { t: string; lat: number; lon: number };
type Candidate = {
  shipId: string;
  shipName: string;
  points: PathPoint[];
  lastSeenAt: string;
  score: number;
  confidenceBand: "high" | "low" | "no";
  approachScore: number;
  proximityScore: number;
  directionScore: number;
  tangentialPenalty: number;
  cosineTowardness: number;
  darknessScore: number;
  readinessScore: number;
  onePointPostAnchoringPenalty: number;
  alignedPoints: number;
  speedQuality: number;
  approachConfidence: number;
  proximityRaw: number;
  approachDirectionRaw: number;
  lastSegmentKnots: number;
  prevSegmentKnots: number;
};

export default function CandidatePathsMap({
  candidates,
  selectedShipIds,
  colorSelectedWhenFiltered,
  onToggleShip,
  eastLon,
  westLon,
}: {
  candidates: Candidate[];
  selectedShipIds?: string[];
  colorSelectedWhenFiltered?: boolean;
  onToggleShip?: (shipId: string) => void;
  eastLon: number;
  westLon: number;
}) {
  const selectedSet = useMemo(() => new Set(selectedShipIds || []), [selectedShipIds]);
  const selected = useMemo(() => candidates.filter((c) => selectedSet.has(c.shipId)), [candidates, selectedSet]);

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
        const isSelected = selectedSet.has(c.shipId);
        const shipColor = colorForShip(c.shipId);
        const baseColor = isSelected ? (colorSelectedWhenFiltered ? shipColor : "#000000") : shipColor;

        return (
          <Fragment key={`cand-${c.shipId}`}>
            <Polyline
              key={`cand-line-${c.shipId}`}
              positions={polyline}
              pathOptions={{ color: baseColor, weight: isSelected ? 1.2 : 1.1, opacity: isSelected ? 0.95 : 0.72, dashArray: isSelected ? "3 6" : "4 8" }}
              eventHandlers={{ click: () => onToggleShip?.(c.shipId) }}
            />
            {c.points.map((p, idx) => {
              const prev = c.points[idx - 1];
              const next = c.points[idx + 1];
              const deg = next
                ? headingDeg({ lat: p.lat, lon: p.lon }, { lat: next.lat, lon: next.lon })
                : prev
                  ? headingDeg({ lat: prev.lat, lon: prev.lon }, { lat: p.lat, lon: p.lon })
                  : 0;
              return (
              <Marker
                key={`cand-pt-${c.shipId}-${idx}`}
                position={[p.lat, p.lon]}
                icon={triangleIcon(baseColor, deg, isSelected ? 11 : 10)}
                eventHandlers={{ click: () => onToggleShip?.(c.shipId) }}
              >
                <Tooltip>
                  {c.shipName} ({c.shipId}) — {new Date(p.t).toUTCString()} — {c.confidenceBand === "high" ? "high" : c.confidenceBand === "low" ? "low" : "none"}
                </Tooltip>
              </Marker>
            )})}
            <Marker
              key={`cand-last-${c.shipId}`}
              position={[last.lat, last.lon]}
              eventHandlers={{ click: () => onToggleShip?.(c.shipId) }}
              icon={divIcon({
                className: "",
                html: "",
                iconSize: [1, 1],
                iconAnchor: [0, 0],
              })}
            >
              <Popup>
                <div style={{ minWidth: 260 }}>
                  <div><strong>Ship:</strong> {c.shipName} ({c.shipId})</div>
                  <div><strong>Last seen:</strong> {new Date(c.lastSeenAt).toUTCString()}</div>
                  <div><strong>Candidate score:</strong> {c.score.toFixed(1)}</div>
                  <div><strong>Confidence:</strong> {c.confidenceBand === "high" ? "high" : c.confidenceBand === "low" ? "low" : "no confidence"}</div>
                  <div style={{ marginTop: 8 }}><strong>Score components</strong></div>
                  <div>Approach score: {c.approachScore.toFixed(1)}</div>
                  <div>Proximity score: {c.proximityScore.toFixed(1)}</div>
                  <div>Direction score: {c.directionScore.toFixed(1)}</div>
                  <div>Tangential penalty: {c.tangentialPenalty.toFixed(1)}</div>
                  <div>Readiness score: {c.readinessScore.toFixed(1)}</div>
                  <div>One-point post-anchoring penalty: {c.onePointPostAnchoringPenalty.toFixed(1)}</div>
                  <div style={{ marginTop: 6 }}><strong>Sub-parameters</strong></div>
                  <div>Dark hours (filter only): {((Date.now() - +new Date(c.lastSeenAt)) / (1000 * 60 * 60)).toFixed(1)}</div>
                  <div>Last seg speed (kn): {c.lastSegmentKnots.toFixed(1)}</div>
                  <div>Prev seg speed (kn): {c.prevSegmentKnots.toFixed(1)}</div>
                  <div>Aligned points: {c.alignedPoints}</div>
                  <div>Speed quality: {c.speedQuality.toFixed(2)}</div>
                  <div>Approach confidence: {c.approachConfidence.toFixed(2)}</div>
                  <div>Proximity raw: {c.proximityRaw.toFixed(2)}</div>
                  <div>Direction raw: {c.approachDirectionRaw.toFixed(2)}</div>
                  <div>Cosine towardness: {c.cosineTowardness.toFixed(2)}</div>
                  <div style={{ marginTop: 6 }}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`} target="_blank" rel="noreferrer">Open MarineTraffic</a></div>
                </div>
              </Popup>
            </Marker>
          </Fragment>
        );
      })}

      {selected.map((s) => {
        const labelColor = scoreToYellowGreen(s.score);
        return (
        <Marker
          key={`selected-pill-${s.shipId}`}
          position={[s.points[s.points.length - 1].lat, s.points[s.points.length - 1].lon]}
          icon={divIcon({
            className: "",
            html: `<div style='background:rgba(2,6,23,0.82);border:1px solid ${labelColor};border-radius:7px;padding:4px 6px;color:${labelColor};font-size:10px;white-space:nowrap;'>${s.shipName} — ${new Date(s.lastSeenAt).toUTCString()} — confidence: ${s.confidenceBand === "high" ? "high" : s.confidenceBand === "low" ? "low" : "none"}</div>`,
            iconSize: [380, 22],
            iconAnchor: [0, 30],
          })}
        />
      )})}
    </MapContainer>
  );
}
