"use client";

import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";

type SnapshotPoint = { shipId: string; shipName: string; vesselType: string; lat: number; lon: number };
type Snapshot = { t: string; points: SnapshotPoint[] };
type CrossingHour = { hour: string; east_to_west: number; west_to_east: number };
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

type CrossingEvent = {
  t: string;
  hour: string;
  shipId: string;
  shipName: string;
  vesselType: string;
  direction: "east_to_west" | "west_to_east";
};

type ExternalPresencePoint = {
  shipId: string;
  shipName: string;
  vesselType: string;
  region: string;
  t: string;
  lat: number;
  lon: number;
  linkedToHormuz: boolean;
};

type LinkageEvent = {
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  fromRegion: string;
  toRegion: string;
  hormuzWestTime: string;
  hormuzWestLat: number;
  hormuzWestLon: number;
  otherRegion: string;
  otherRegionTime: string;
  otherLat: number;
  otherLon: number;
  deltaHours: number;
  deltaDh: string;
};

type CandidateCrosser = {
  shipId: string;
  shipName: string;
  vesselType: string;
  score: number;
  confidenceBand: "high" | "low" | "no";
  alignedPoints: number;
  speedQuality: number;
  approachConfidence: number;
  darkHours: number;
  proximityRaw: number;
  approachDirectionRaw: number;
  proximityScore: number;
  approachScore: number;
  darknessScore: number;
  directionScore: number;
  tangentialPenalty: number;
  cosineTowardness: number;
  readinessScore: number;
  onePointPostAnchoringPenalty: number;
  lastSegmentKnots: number;
  prevSegmentKnots: number;
  lastSeenAt: string;
  lastLat: number;
  lastLon: number;
  points: PathPoint[];
};


type AreaEntryEvent = {
  t: string;
  hour: string;
  shipId: string;
  shipName: string;
  vesselType: string;
  location: string;
  eventType: "entry";
};

type AreaPath = {
  shipId: string;
  shipName: string;
  vesselType: string;
  points: PathPoint[];
};

type ShipMeta = {
  shipName: string;
  vesselType: string;
  flag?: string;
  destination?: string;
  rawShipType?: string;
  rawGtShipType?: string;
  latestElapsedMinutes?: string | null;
  latestSeenEstimatedUtc?: string | null;
  latestSpeedRaw?: string | null;
  latestCourseRaw?: string | null;
};

type NewsSource = {
  id: string;
  name: string;
  type: string;
  url: string;
  priority: number;
  tags: string[];
};

type NewsItem = {
  id: string;
  title: string;
  url: string;
  canonicalUrl?: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  publishedAt: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  summary: string;
  tags: string[];
  figureNote?: string | null;
  isNew?: boolean;
  lastRunAt?: string;
};

type NewsSummary = {
  headline: string;
  body: string;
  generatedAt: string;
};

type NewsFeedShape = {
  metadata: {
    generatedAt: string;
    profile: string;
    sourceCount: number;
    itemCount: number;
    lastRunAt?: string;
    newItemCount?: number;
  };
  lastUpdateSummary: NewsSummary;
  last24hSummary: NewsSummary;
  sources: NewsSource[];
  items: NewsItem[];
};

type CandidatesShape = {
  data?: {
    tankerCandidates?: CandidateCrosser[];
    cargoCandidates?: CandidateCrosser[];
    relevantExternalPoints?: ExternalPresencePoint[];
  };
};

type DataShape = {
  metadata: {
    generatedAt: string;
    eastLon: number;
    westLon: number;
    minLat?: number;
    westMinLon?: number;
    fileCount: number;
    shipCount: number;
    crossingShipCount: number;
    crossingEventCount: number;
    linkageEventCount?: number;
  };
  vesselTypes: string[];
  shipMeta: Record<string, ShipMeta>;
  snapshots: Snapshot[];
  crossingsByHour: CrossingHour[];
  crossingEvents: CrossingEvent[];
  crossingPaths: CrossingPath[];
  linkageEvents?: LinkageEvent[];
  externalPresencePoints?: ExternalPresencePoint[];
};

const PlaybackMap = dynamic(() => import("@/components/PlaybackMap"), { ssr: false });
const CrossingPathsMap = dynamic(() => import("@/components/CrossingPathsMap"), { ssr: false });
const CandidatePathsMap = dynamic(() => import("@/components/CandidatePathsMap"), { ssr: false });
const PortAreaPathsMap = dynamic(() => import("@/components/PortAreaPathsMap"), { ssr: false });

function formatShipDisplayName(shipName: string, flag?: string | null) {
  const cleanName = String(shipName || "Unknown").trim() || "Unknown";
  const cleanFlag = String(flag || "").trim();
  return cleanFlag ? `${cleanName} [${cleanFlag}]` : cleanName;
}


function alignHours(
  source: { hour: string; east_to_west: number; west_to_east: number }[],
  allHours: string[],
) {
  const map = new Map(source.map((x) => [x.hour, x]));
  return allHours.map((hour) => map.get(hour) || { hour, east_to_west: 0, west_to_east: 0 });
}

function toHourStartIso(ts: string) {
  const d = new Date(ts);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function buildContinuousHourRange(startIso: string, endIso: string) {
  const out: string[] = [];
  const cur = new Date(startIso);
  const end = new Date(endIso);
  while (cur <= end) {
    out.push(cur.toISOString());
    cur.setUTCHours(cur.getUTCHours() + 1);
  }
  return out;
}

function classForType(type: string) {
  if (type === "tanker") return "bg-rose-500";
  if (type === "cargo") return "bg-green-500";
  return "bg-amber-500";
}

function formatHourTick(iso: string) {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  return `${day}/${month} ${hour}:00`;
}

function buildReadableTicks(hours: string[]) {
  if (!hours.length) return [] as string[];
  const total = hours.length;
  const step = total <= 72 ? 3 : total <= 168 ? 6 : total <= 336 ? 12 : 24;

  const ticks: string[] = [];
  for (const h of hours) {
    const d = new Date(h);
    if (d.getUTCHours() % step === 0) ticks.push(h);
  }

  if (ticks[0] !== hours[0]) ticks.unshift(hours[0]);
  if (ticks[ticks.length - 1] !== hours[hours.length - 1]) ticks.push(hours[hours.length - 1]);
  return ticks;
}

function aggregateToSixHourBins(rows: CrossingHour[]) {
  const out = new Map<string, CrossingHour>();
  for (const r of rows) {
    const d = new Date(r.hour);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6);
    const key = d.toISOString();
    if (!out.has(key)) out.set(key, { hour: key, east_to_west: 0, west_to_east: 0 });
    out.get(key)!.east_to_west += r.east_to_west;
    out.get(key)!.west_to_east += r.west_to_east;
  }
  return [...out.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function cosineTowardMidpoint(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  midpoint: { lat: number; lon: number },
) {
  const mvLat = to.lat - from.lat;
  const mvLon = to.lon - from.lon;
  const tvLat = midpoint.lat - from.lat;
  const tvLon = midpoint.lon - from.lon;
  const mNorm = Math.hypot(mvLat, mvLon);
  const tNorm = Math.hypot(tvLat, tvLon);
  if (mNorm === 0 || tNorm === 0) return 0;
  const cos = (mvLat * tvLat + mvLon * tvLon) / (mNorm * tNorm);
  return Math.max(-1, Math.min(1, cos));
}

function csvEscape(value: unknown) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function computeLikelyDarkCrossers(
  candidateSnapshots: Snapshot[],
  data: DataShape | null,
  crossingShipIds: Set<string>,
  allowedTypes: string[] = ["tanker"],
) {
  if (!candidateSnapshots?.length || !data) return [] as CandidateCrosser[];

  const latestTs = +new Date(candidateSnapshots[candidateSnapshots.length - 1].t);
  const byShip = new Map<string, { shipName: string; vesselType: string; points: PathPoint[] }>();

  for (const s of candidateSnapshots) {
    for (const p of s.points) {
      if (!allowedTypes.includes(p.vesselType)) continue;
      if (!byShip.has(p.shipId)) byShip.set(p.shipId, { shipName: p.shipName, vesselType: p.vesselType, points: [] });
      byShip.get(p.shipId)!.points.push({ t: s.t, lat: p.lat, lon: p.lon });
    }
  }

  const centerLon = (data.metadata.eastLon + data.metadata.westLon) / 2;
  const centerLat = 26.25;
  const out: CandidateCrosser[] = [];

  for (const [shipId, v] of byShip.entries()) {
    const pts = v.points.sort((a, b) => +new Date(a.t) - +new Date(b.t));
    if (pts.length < 3) continue;
    if (crossingShipIds.has(shipId)) continue;

    const last = pts[pts.length - 1];
    const darkHours = (latestTs - +new Date(last.t)) / (1000 * 60 * 60);
    if (darkHours <= 6) continue;

    const tail = pts.slice(-Math.min(6, pts.length));
    if (tail.length < 3) continue;

    let aligned = 0;
    let speedQuality = 0;
    let segCount = 0;
    let towardCosineSum = 0;
    const segSpeeds: number[] = [];

    for (let i = 1; i < tail.length; i++) {
      const a = tail[i - 1];
      const b = tail[i];
      const distPrev = haversineKm(a.lat, a.lon, centerLat, centerLon);
      const distCur = haversineKm(b.lat, b.lon, centerLat, centerLon);
      if (distCur < distPrev) aligned += 1;

      const dtHours = Math.max((+new Date(b.t) - +new Date(a.t)) / (1000 * 60 * 60), 1 / 60);
      const speedKnots = (haversineKm(a.lat, a.lon, b.lat, b.lon) / dtHours) / 1.852;
      const cosToward = cosineTowardMidpoint(a, b, { lat: centerLat, lon: centerLon });
      towardCosineSum += Math.max(0, cosToward);
      segSpeeds.push(speedKnots);
      if (speedKnots < 3) speedQuality += 0.2;
      else if (speedKnots <= 23) speedQuality += 1;
      else if (speedKnots <= 30) speedQuality += 0.5;
      else speedQuality += 0.1;
      segCount += 1;
    }

    const alignedPoints = aligned + 1;
    if (alignedPoints < 3) continue;

    const speedScore = segCount ? speedQuality / segCount : 0;
    const approachConfidence = Math.min(1, (alignedPoints / Math.max(3, tail.length)) * speedScore);
    const lastMidDistKm = haversineKm(last.lat, last.lon, centerLat, centerLon);
    if (lastMidDistKm > 300) continue;
    const proximityRaw = 1 - Math.min(1, lastMidDistKm / 160);
    const prev = tail[tail.length - 2];
    const lastDist = haversineKm(last.lat, last.lon, centerLat, centerLon);
    const prevDist = haversineKm(prev.lat, prev.lon, centerLat, centerLon);
    const towardDeltaKm = prevDist - lastDist;
    const approachDirectionRaw = Math.max(-1, Math.min(1, towardDeltaKm / 8));

    const approachScore = approachConfidence * 55;
    const proximityScore = proximityRaw * 20;
    const directionScore = approachDirectionRaw > 0 ? approachDirectionRaw * 25 : approachDirectionRaw * 20;
    const cosineTowardness = segCount ? towardCosineSum / segCount : 0;
    const tangentialPenalty = approachDirectionRaw > 0 ? -(1 - cosineTowardness) * 5 : 0;
    const darknessScore = 0;

    const lastSegmentKnots = segSpeeds.length ? segSpeeds[segSpeeds.length - 1] : 0;
    const prevSegmentKnots = segSpeeds.length > 1 ? segSpeeds[segSpeeds.length - 2] : lastSegmentKnots;
    let readinessScore = 0;
    if (lastSegmentKnots < 2 && approachDirectionRaw <= 0) readinessScore = -12;
    if (lastSegmentKnots >= 4 && lastSegmentKnots > prevSegmentKnots && approachDirectionRaw > 0) readinessScore = 4;

    let onePointPostAnchoringPenalty = 0;
    if (segSpeeds.length >= 2) {
      const anchorLikeCount = segSpeeds.slice(0, -1).filter((v) => v < 2).length;
      const hasAnchorLikeHistory = anchorLikeCount >= 1;
      const hasOnlyOnePostAnchorSegment = segSpeeds[segSpeeds.length - 1] >= 2 && segSpeeds[segSpeeds.length - 2] < 2;
      if (hasAnchorLikeHistory && hasOnlyOnePostAnchorSegment) onePointPostAnchoringPenalty = -6;
    }

    const score = approachScore + proximityScore + directionScore + tangentialPenalty + readinessScore + onePointPostAnchoringPenalty;
    let confidenceBand: "high" | "low" | "no" = score > 50 ? "high" : score >= 30 ? "low" : "no";
    if (lastMidDistKm > 90 && confidenceBand === "high") confidenceBand = "low";

    out.push({
      shipId,
      shipName: v.shipName,
      vesselType: v.vesselType,
      score,
      confidenceBand,
      alignedPoints,
      speedQuality: speedScore,
      approachConfidence,
      darkHours,
      proximityRaw,
      approachDirectionRaw,
      proximityScore,
      approachScore,
      darknessScore,
      directionScore,
      tangentialPenalty,
      cosineTowardness,
      readinessScore,
      onePointPostAnchoringPenalty,
      lastSegmentKnots,
      prevSegmentKnots,
      lastSeenAt: last.t,
      lastLat: last.lat,
      lastLon: last.lon,
      points: pts,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 80);
}


function kmToLatDegrees(km: number) {
  return km / 110.574;
}

function kmToLonDegrees(km: number, lat: number) {
  return km / (111.320 * Math.cos((lat * Math.PI) / 180));
}

function computeAreaEntryAnalytics(
  snapshots: Snapshot[],
  centerLat: number,
  centerLon: number,
  widthKm: number,
  heightKm: number,
  allowedTypes: string[] = ["tanker", "cargo"],
  location = "monitored_area",
) {
  if (!snapshots?.length) {
    return {
      bounds: { minLat: centerLat, maxLat: centerLat, minLon: centerLon, maxLon: centerLon },
      events: [] as AreaEntryEvent[],
      paths: [] as AreaPath[],
    };
  }

  const halfHeightKm = heightKm / 2;
  const halfWidthKm = widthKm / 2;
  const latDelta = kmToLatDegrees(halfHeightKm);
  const lonDelta = kmToLonDegrees(halfWidthKm, centerLat);
  const bounds = {
    minLat: centerLat - latDelta,
    maxLat: centerLat + latDelta,
    minLon: centerLon - lonDelta,
    maxLon: centerLon + lonDelta,
  };

  const inside = (lat: number, lon: number) =>
    lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon;

  const shipPoints = new Map<string, { shipName: string; vesselType: string; points: PathPoint[] }>();
  const prevInside = new Map<string, boolean>();
  const events: AreaEntryEvent[] = [];

  const sortedSnapshots = [...snapshots].sort((a, b) => +new Date(a.t) - +new Date(b.t));
  for (const s of sortedSnapshots) {
    const present = new Set<string>();
    for (const p of s.points) {
      if (!allowedTypes.includes(p.vesselType)) continue;
      present.add(p.shipId);
      if (!shipPoints.has(p.shipId)) shipPoints.set(p.shipId, { shipName: p.shipName, vesselType: p.vesselType, points: [] });
      shipPoints.get(p.shipId)!.points.push({ t: s.t, lat: p.lat, lon: p.lon });

      const isInside = inside(p.lat, p.lon);
      const wasInside = prevInside.get(p.shipId) || false;
      if (isInside && !wasInside) {
        events.push({
          t: s.t,
          hour: toHourStartIso(s.t),
          shipId: p.shipId,
          shipName: p.shipName,
          vesselType: p.vesselType,
          location,
          eventType: "entry",
        });
      }
      prevInside.set(p.shipId, isInside);
    }

    for (const shipId of [...prevInside.keys()]) {
      if (!present.has(shipId)) prevInside.set(shipId, false);
    }
  }

  const shipsInArea = new Set(events.map((e) => e.shipId));
  const paths: AreaPath[] = [...shipPoints.entries()]
    .filter(([shipId]) => shipsInArea.has(shipId))
    .map(([shipId, v]) => ({
      shipId,
      shipName: v.shipName,
      vesselType: v.vesselType,
      points: v.points.sort((a, b) => +new Date(a.t) - +new Date(b.t)),
    }))
    .sort((a, b) => a.shipName.localeCompare(b.shipName));

  return { bounds, events, paths };
}

function computeAreaUnionAnalytics(
  analytics: { bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }; events: AreaEntryEvent[]; paths: AreaPath[] }[],
  location = "monitored_area_union",
) {
  const nonEmpty = analytics.filter(Boolean);
  if (!nonEmpty.length) {
    return {
      bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      events: [] as AreaEntryEvent[],
      paths: [] as AreaPath[],
    };
  }

  const bounds = {
    minLat: Math.min(...nonEmpty.map((a) => a.bounds.minLat)),
    maxLat: Math.max(...nonEmpty.map((a) => a.bounds.maxLat)),
    minLon: Math.min(...nonEmpty.map((a) => a.bounds.minLon)),
    maxLon: Math.max(...nonEmpty.map((a) => a.bounds.maxLon)),
  };

  const eventMap = new Map<string, AreaEntryEvent>();
  for (const a of nonEmpty) {
    for (const e of a.events) {
      const key = `${e.shipId}|${e.t}|${e.location}`;
      eventMap.set(key, { ...e, location });
    }
  }
  const events = [...eventMap.values()].sort((a, b) => +new Date(a.t) - +new Date(b.t));

  const pathMap = new Map<string, AreaPath>();
  for (const a of nonEmpty) {
    for (const p of a.paths) {
      if (!pathMap.has(p.shipId)) {
        pathMap.set(p.shipId, { ...p, points: [...p.points] });
      } else {
        const existing = pathMap.get(p.shipId)!;
        const pts = [...existing.points, ...p.points];
        const uniq = new Map(pts.map((pt) => [`${pt.t}|${pt.lat}|${pt.lon}`, pt]));
        existing.points = [...uniq.values()].sort((x, y) => +new Date(x.t) - +new Date(y.t));
      }
    }
  }

  return {
    bounds,
    events,
    paths: [...pathMap.values()].sort((a, b) => a.shipName.localeCompare(b.shipName)),
  };
}

export default function Page() {
  const [data, setData] = useState<DataShape | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [selectedTankerHour, setSelectedTankerHour] = useState<string | null>(null);
  const [selectedCargoHour, setSelectedCargoHour] = useState<string | null>(null);
  const [selectedJaskTankerHour, setSelectedJaskTankerHour] = useState<string | null>(null);
  const [selectedJaskCargoHour, setSelectedJaskCargoHour] = useState<string | null>(null);
  const [showEastToWest, setShowEastToWest] = useState(true);
  const [showWestToEast, setShowWestToEast] = useState(true);
  const [showCrossing, setShowCrossing] = useState(true);
  const [showNonCrossing, setShowNonCrossing] = useState(true);
  const [showOnlyLinkedExternal, setShowOnlyLinkedExternal] = useState(false);
  const [loadAllRegions, setLoadAllRegions] = useState(false);
  const [crossingMapTypes, setCrossingMapTypes] = useState<string[]>(["tanker"]);
  const [crossingDirectionFilter, setCrossingDirectionFilter] = useState<"all" | "east_to_west" | "west_to_east">("all");
  const [crossingWindow, setCrossingWindow] = useState<"24h" | "48h" | "all">("all");
  const [selectedCrossingShipIds, setSelectedCrossingShipIds] = useState<string[]>([]);
  const [playbackWindow, setPlaybackWindow] = useState<"24h" | "48h">("24h");
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [externalPoints, setExternalPoints] = useState<ExternalPresencePoint[]>([]);
  const [tankerCandidatesData, setTankerCandidatesData] = useState<CandidateCrosser[]>([]);
  const [cargoCandidatesData, setCargoCandidatesData] = useState<CandidateCrosser[]>([]);
  const [tankerSort, setTankerSort] = useState<{ key: "ship" | "timestamp" | "direction"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [cargoSort, setCargoSort] = useState<{ key: "ship" | "timestamp" | "direction"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [linkSort, setLinkSort] = useState<{ key: "ship" | "type" | "timestamp" | "transit"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [crossingDetailSort, setCrossingDetailSort] = useState<{ key: "ship" | "type" | "direction" | "timestamp" | "transit"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [selectedCandidateShipIds, setSelectedCandidateShipIds] = useState<string[]>([]);
  const [showOnlySelectedCandidates, setShowOnlySelectedCandidates] = useState(true);
  const [candidateSort, setCandidateSort] = useState<{ key: "ship" | "lastSeen" | "darkHours" | "alignedPoints" | "speedQuality" | "approachConfidence" | "score" | "confidence"; dir: "asc" | "desc" }>({ key: "confidence", dir: "desc" });
  const [newsFeed, setNewsFeed] = useState<NewsFeedShape | null>(null);
  const [newDataAvailable, setNewDataAvailable] = useState(false);
  const candidateDefaultsAppliedRef = useRef(false);
  const crossingDefaultsAppliedRef = useRef(false);
  const interactionAtRef = useRef<number>(Date.now());
  const mountedAtRef = useRef<number>(Date.now());
  const latestGeneratedAtRef = useRef<string | null>(null);

  useEffect(() => {
    const root = process.env.NEXT_PUBLIC_HORMUZ_DATA_ROOT || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/multi_region";
    const remoteNewsUrl = process.env.NEXT_PUBLIC_HORMUZ_NEWS_URL || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/news_feed.json";

    const fetchJson = async (url: string) => {
      const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);
      if (!r.ok) throw new Error(`fetch failed ${r.status}`);
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let text = "";
      const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
      if (isGzip && typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("gzip");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder().decode(bytes);
      }
      return JSON.parse(text);
    };

    const loadNews = async () => {
      try {
        const news = await fetchJson(remoteNewsUrl);
        setNewsFeed(news as NewsFeedShape);
        return;
      } catch {
        // fall through to local artifact
      }
      try {
        const news = await fetchJson(`${root}/news_feed.json`);
        setNewsFeed(news as NewsFeedShape);
      } catch {
        setNewsFeed(null);
      }
    };

    const load = async () => {
      await loadNews();
      try {
        const core = await fetchJson(`${root}/processed_core.json`);
        const paths = await fetchJson(`${root}/processed_paths.json`);
        const candidates = await fetchJson(`${root}/processed_candidates.json`);
        const playback24 = await fetchJson(`${root}/processed_playback_24h.json`);
        const shipmeta24 = await fetchJson(`${root}/processed_shipmeta_24h.json`);

        const normalized: DataShape = {
          metadata: core?.metadata || {
            generatedAt: new Date().toISOString(),
            eastLon: 56.4,
            westLon: 56.15,
            minLat: 24,
            fileCount: 0,
            shipCount: 0,
            crossingShipCount: 0,
            crossingEventCount: 0,
          },
          vesselTypes: Array.isArray(core?.data?.vesselTypes) ? core.data.vesselTypes : [],
          shipMeta: shipmeta24?.data?.shipMeta || core?.data?.shipMeta || {},
          snapshots: Array.isArray(playback24?.data?.snapshots) ? playback24.data.snapshots : [],
          crossingsByHour: Array.isArray(core?.data?.crossingsByHour) ? core.data.crossingsByHour : [],
          crossingEvents: Array.isArray(core?.data?.crossingEvents) ? core.data.crossingEvents : [],
          crossingPaths: Array.isArray(paths?.data?.crossingPaths) ? paths.data.crossingPaths : [],
          linkageEvents: Array.isArray(core?.data?.linkageEvents) ? core.data.linkageEvents : [],
          externalPresencePoints: Array.isArray(core?.data?.externalPresencePoints) ? core.data.externalPresencePoints : [],
        };

        setSplitMode(true);
        setData(normalized);
        setTankerCandidatesData(Array.isArray(candidates?.data?.tankerCandidates) ? candidates.data.tankerCandidates : []);
        setCargoCandidatesData(Array.isArray(candidates?.data?.cargoCandidates) ? candidates.data.cargoCandidates : []);
        setExternalPoints(Array.isArray(candidates?.data?.relevantExternalPoints) ? candidates.data.relevantExternalPoints : []);
        const defaults = normalized.vesselTypes.includes("tanker") ? ["tanker"] : normalized.vesselTypes;
        setSelectedTypes(defaults);
        setCrossingMapTypes(normalized.vesselTypes.includes("tanker") ? ["tanker"] : defaults);
        return;
      } catch (err) {
        console.error("Failed to load split dashboard artifacts", err);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (!data?.metadata?.generatedAt) return;
    latestGeneratedAtRef.current = data.metadata.generatedAt;
  }, [data?.metadata?.generatedAt]);

  useEffect(() => {
    const bump = () => {
      interactionAtRef.current = Date.now();
    };
    window.addEventListener("mousemove", bump, { passive: true });
    window.addEventListener("keydown", bump);
    window.addEventListener("touchstart", bump, { passive: true });
    window.addEventListener("scroll", bump, { passive: true });
    return () => {
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("touchstart", bump);
      window.removeEventListener("scroll", bump);
    };
  }, []);

  useEffect(() => {
    const isIdle = () => Date.now() - interactionAtRef.current > 120000;

    const checkForFreshData = async () => {
      const root = process.env.NEXT_PUBLIC_HORMUZ_DATA_ROOT || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/multi_region";
      try {
        const r = await fetch(`${root}/processed_core.json?t=${Date.now()}`);
        if (r.ok) {
          const j = await r.json();
          const remoteGen = j?.metadata?.generatedAt as string | undefined;
          const localGen = latestGeneratedAtRef.current;
          if (remoteGen && localGen && +new Date(remoteGen) > +new Date(localGen)) {
            setNewDataAvailable(true);
            if (isIdle()) window.location.reload();
          }
        }
      } catch {
        // ignore polling errors
      }

      const elapsed = Date.now() - mountedAtRef.current;
      if (elapsed > 45 * 60 * 1000 && isIdle()) {
        window.location.reload();
      }
    };

    const id = setInterval(checkForFreshData, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!newDataAvailable) return;
    const id = setInterval(() => {
      if (Date.now() - interactionAtRef.current > 120000) {
        window.location.reload();
      }
    }, 30000);
    return () => clearInterval(id);
  }, [newDataAvailable]);

  useEffect(() => {
    if (!playing || !data?.snapshots?.length) return;
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % data.snapshots.length);
    }, 650);
    return () => clearInterval(id);
  }, [playing, data?.snapshots?.length]);

  useEffect(() => {
    if (!splitMode || !data) return;
    const root = process.env.NEXT_PUBLIC_HORMUZ_DATA_ROOT || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/multi_region";

    const fetchJsonMaybeGzip = async (url: string) => {
      const r = await fetch(`${url}?t=${Date.now()}`);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let text = "";
      const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
      if (isGzip && typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("gzip");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder().decode(bytes);
      }
      return JSON.parse(text);
    };

    const fetchWindowData = async () => {
      setPlaybackLoading(true);
      try {
        const playbackJson = await fetchJsonMaybeGzip(`${root}/processed_playback_${playbackWindow}.json`);
        const shipmetaJson = await fetchJsonMaybeGzip(`${root}/processed_shipmeta_${playbackWindow}.json`);
        const externalJson = loadAllRegions ? await fetchJsonMaybeGzip(`${root}/processed_external_${playbackWindow}.json`) : null;
        const snaps = Array.isArray(playbackJson?.data?.snapshots) ? playbackJson.data.snapshots : [];
        const ext = Array.isArray(externalJson?.data?.externalPresencePoints) ? externalJson.data.externalPresencePoints : [];
        const sm = shipmetaJson?.data?.shipMeta || {};
        setData((prev) => (prev ? { ...prev, snapshots: snaps, shipMeta: sm } : prev));
        setExternalPoints(ext);
        setFrameIndex(0);
      } finally {
        setPlaybackLoading(false);
      }
    };

    fetchWindowData();
  }, [splitMode, playbackWindow, loadAllRegions]);

  const currentSnapshot = data?.snapshots?.[frameIndex];

  const filteredCurrentPoints = useMemo(() => {
    if (!currentSnapshot) return [];
    return currentSnapshot.points.filter((p) => selectedTypes.includes(p.vesselType));
  }, [currentSnapshot, selectedTypes]);

  const filteredCrossingPaths = useMemo(() => {
    if (!data) return [];
    return (data.crossingPaths || []).filter((p) => selectedTypes.includes(p.vesselType));
  }, [data, selectedTypes]);

  const crossingShipIds = useMemo(() => new Set((data?.crossingPaths || []).map((p) => p.shipId)), [data]);

  const candidateCrossers = useMemo(() => tankerCandidatesData || [], [tankerCandidatesData]);

  const cargoCandidateCrossers = useMemo(() => cargoCandidatesData || [], [cargoCandidatesData]);

  const candidateCrossersForDisplay = useMemo(() => candidateCrossers, [candidateCrossers]);

  const jaskCenter = useMemo(() => ({ lat: 25.65, lon: 57.78 }), []);
  const jaskFacilitiesCenter = useMemo(() => ({ lat: 25.82, lon: 57.28 }), []);
  const jaskPortAnalytics = useMemo(
    () => computeAreaEntryAnalytics(data?.snapshots || [], jaskCenter.lat, jaskCenter.lon, 26.7, 26.7, ["tanker", "cargo"], "jask_port_area"),
    [data?.snapshots, jaskCenter],
  );
  const jaskFacilitiesAnalytics = useMemo(
    () => computeAreaEntryAnalytics(data?.snapshots || [], jaskFacilitiesCenter.lat, jaskFacilitiesCenter.lon, 13, 20, ["tanker", "cargo"], "jask_port_facilities"),
    [data?.snapshots, jaskFacilitiesCenter],
  );
  const jaskAnalytics = useMemo(
    () => computeAreaUnionAnalytics([jaskPortAnalytics, jaskFacilitiesAnalytics], "jask_combined_area"),
    [jaskPortAnalytics, jaskFacilitiesAnalytics],
  );

  const jaskEvents = jaskAnalytics.events;
  const jaskPaths = jaskAnalytics.paths;
  const latestCandidateSnapshotTs = useMemo(
    () => (data?.snapshots?.length ? +new Date(data.snapshots[data.snapshots.length - 1].t) : +new Date(data?.metadata?.generatedAt || 0)),
    [data?.snapshots, data?.metadata?.generatedAt],
  );
  const jaskCutoffTs = latestCandidateSnapshotTs - 24 * 60 * 60 * 1000;
  const jaskLast48hCounts = useMemo(() => {
    const tankerIds = new Set<string>();
    const cargoIds = new Set<string>();
    for (const e of jaskEvents) {
      const ts = +new Date(e.t);
      if (ts < jaskCutoffTs || ts > latestCandidateSnapshotTs) continue;
      if (e.vesselType === "tanker") tankerIds.add(e.shipId);
      if (e.vesselType === "cargo") cargoIds.add(e.shipId);
    }
    return { tanker: tankerIds.size, cargo: cargoIds.size };
  }, [jaskEvents, jaskCutoffTs, latestCandidateSnapshotTs]);

  const candidateShipIds = useMemo(() => new Set(candidateCrossers.map((c) => c.shipId)), [candidateCrossers]);
  const candidateLast24hHighCount = useMemo(
    () => candidateCrossers.filter((c) => c.confidenceBand === "high" && c.darkHours <= 24).length,
    [candidateCrossers],
  );
  const candidateLast24hLowCount = useMemo(
    () => candidateCrossers.filter((c) => c.confidenceBand === "low" && c.darkHours <= 24).length,
    [candidateCrossers],
  );
  const selectedCandidateShipIdSet = useMemo(() => new Set(selectedCandidateShipIds), [selectedCandidateShipIds]);

  useEffect(() => {
    const valid = new Set(candidateCrossers.map((c) => c.shipId));
    const high24hIds = candidateCrossersForDisplay
      .filter((c) => c.confidenceBand === "high" && c.darkHours <= 24)
      .map((c) => c.shipId);

    if (!candidateDefaultsAppliedRef.current) {
      setSelectedCandidateShipIds(high24hIds);
      candidateDefaultsAppliedRef.current = true;
      return;
    }

    setSelectedCandidateShipIds((prev) => {
      const stillValid = prev.filter((id) => valid.has(id));
      if (stillValid.length === 0 && high24hIds.length) return high24hIds;
      return stillValid;
    });
  }, [candidateCrossersForDisplay, candidateCrossers]);

  const hourlyFromEvents = (vesselType: string) => {
    if (!data?.crossingEvents?.length) return [] as CrossingHour[];
    const byHour = new Map<string, { hour: string; east_to_west: number; west_to_east: number }>();
    for (const e of data.crossingEvents) {
      if (e.vesselType !== vesselType) continue;
      if (!byHour.has(e.hour)) byHour.set(e.hour, { hour: e.hour, east_to_west: 0, west_to_east: 0 });
      if (e.direction === "east_to_west") byHour.get(e.hour)!.east_to_west += 1;
      if (e.direction === "west_to_east") byHour.get(e.hour)!.west_to_east += 1;
    }
    return [...byHour.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
  };

  const tankerHourly = useMemo(() => hourlyFromEvents("tanker"), [data]);
  const cargoHourly = useMemo(() => hourlyFromEvents("cargo"), [data]);

  const hourlyFromAreaEntries = (events: AreaEntryEvent[], vesselType: string) => {
    if (!events?.length) return [] as CrossingHour[];
    const byHour = new Map<string, { hour: string; east_to_west: number; west_to_east: number }>();
    for (const e of events) {
      if (e.vesselType !== vesselType) continue;
      if (!byHour.has(e.hour)) byHour.set(e.hour, { hour: e.hour, east_to_west: 0, west_to_east: 0 });
      byHour.get(e.hour)!.east_to_west += 1;
    }
    return [...byHour.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
  };

  const jaskTankerHourly = useMemo(() => hourlyFromAreaEntries(jaskEvents, "tanker"), [jaskEvents]);
  const jaskCargoHourly = useMemo(() => hourlyFromAreaEntries(jaskEvents, "cargo"), [jaskEvents]);

  const sharedHours = useMemo(() => {
    const eventHours = [
      ...(data?.crossingEvents || []).map((e) => e.hour),
      ...jaskEvents.map((e) => e.hour),
    ].sort((a, b) => +new Date(a) - +new Date(b));
    if (!eventHours.length) return [] as string[];
    const start = toHourStartIso(eventHours[0]);
    const end = toHourStartIso(eventHours[eventHours.length - 1]);
    return buildContinuousHourRange(start, end);
  }, [data?.crossingEvents, jaskEvents]);

  const tankerHourlyAligned = useMemo(() => alignHours(tankerHourly, sharedHours), [tankerHourly, sharedHours]);
  const cargoHourlyAligned = useMemo(() => alignHours(cargoHourly, sharedHours), [cargoHourly, sharedHours]);
  const tankerSixHour = useMemo(() => aggregateToSixHourBins(tankerHourlyAligned), [tankerHourlyAligned]);
  const cargoSixHour = useMemo(() => aggregateToSixHourBins(cargoHourlyAligned), [cargoHourlyAligned]);
  const jaskTankerHourlyAligned = useMemo(() => alignHours(jaskTankerHourly, sharedHours), [jaskTankerHourly, sharedHours]);
  const jaskCargoHourlyAligned = useMemo(() => alignHours(jaskCargoHourly, sharedHours), [jaskCargoHourly, sharedHours]);
  const jaskTankerSixHour = useMemo(() => aggregateToSixHourBins(jaskTankerHourlyAligned), [jaskTankerHourlyAligned]);
  const jaskCargoSixHour = useMemo(() => aggregateToSixHourBins(jaskCargoHourlyAligned), [jaskCargoHourlyAligned]);
  const chartTicks = useMemo(() => buildReadableTicks(tankerSixHour.map((x) => x.hour)), [tankerSixHour]);
  const jaskChartTicks = useMemo(() => buildReadableTicks(jaskTankerSixHour.map((x) => x.hour)), [jaskTankerSixHour]);

  const tankerNamesAtSelectedHour = useMemo(() => {
    if (!data || !selectedTankerHour) return [] as { shipName: string; shipId: string; direction: string }[];
    const rows = data.crossingEvents
      .filter((e) => e.hour === selectedTankerHour && e.vesselType === "tanker")
      .map((e) => ({ shipName: e.shipName, shipId: e.shipId, direction: e.direction }));
    const uniq = new Map<string, { shipName: string; shipId: string; direction: string }>();
    for (const r of rows) uniq.set(`${r.shipId}-${r.direction}`, r);
    return [...uniq.values()].sort((a, b) => a.shipName.localeCompare(b.shipName));
  }, [data, selectedTankerHour]);

  const cargoNamesAtSelectedHour = useMemo(() => {
    if (!data || !selectedCargoHour) return [] as { shipName: string; shipId: string; direction: string }[];
    const rows = data.crossingEvents
      .filter((e) => e.hour === selectedCargoHour && e.vesselType === "cargo")
      .map((e) => ({ shipName: e.shipName, shipId: e.shipId, direction: e.direction }));
    const uniq = new Map<string, { shipName: string; shipId: string; direction: string }>();
    for (const r of rows) uniq.set(`${r.shipId}-${r.direction}`, r);
    return [...uniq.values()].sort((a, b) => a.shipName.localeCompare(b.shipName));
  }, [data, selectedCargoHour]);

  const jaskTankerNamesAtSelectedHour = useMemo(() => {
    if (!selectedJaskTankerHour) return [] as { shipName: string; shipId: string }[];
    const rows = jaskEvents
      .filter((e) => e.hour === selectedJaskTankerHour && e.vesselType === "tanker")
      .map((e) => ({ shipName: e.shipName, shipId: e.shipId }));
    const uniq = new Map<string, { shipName: string; shipId: string }>();
    for (const r of rows) uniq.set(r.shipId, r);
    return [...uniq.values()].sort((a, b) => a.shipName.localeCompare(b.shipName));
  }, [jaskEvents, selectedJaskTankerHour]);

  const jaskCargoNamesAtSelectedHour = useMemo(() => {
    if (!selectedJaskCargoHour) return [] as { shipName: string; shipId: string }[];
    const rows = jaskEvents
      .filter((e) => e.hour === selectedJaskCargoHour && e.vesselType === "cargo")
      .map((e) => ({ shipName: e.shipName, shipId: e.shipId }));
    const uniq = new Map<string, { shipName: string; shipId: string }>();
    for (const r of rows) uniq.set(r.shipId, r);
    return [...uniq.values()].sort((a, b) => a.shipName.localeCompare(b.shipName));
  }, [jaskEvents, selectedJaskCargoHour]);

  const tankerTableRows = useMemo(() => {
    if (!data) return [] as CrossingEvent[];
    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const tableWindowHours = crossingWindow === "all" ? null : Number.parseInt(crossingWindow, 10);
    const cutoff = tableWindowHours == null ? null : latestTs - tableWindowHours * 60 * 60 * 1000;
    const rows = (data.crossingEvents || []).filter((e) => {
      if (e.vesselType !== "tanker") return false;
      if (crossingDirectionFilter !== "all" && e.direction !== crossingDirectionFilter) return false;
      if (cutoff != null) {
        const ts = +new Date(e.t);
        if (ts < cutoff || ts > latestTs) return false;
      }
      return true;
    });
    const filtered = selectedTankerHour ? rows.filter((e) => e.hour === selectedTankerHour) : rows;
    return [...filtered].sort((a, b) => {
      if (tankerSort.key === "ship") {
        const cmp = a.shipName.localeCompare(b.shipName);
        return tankerSort.dir === "asc" ? cmp : -cmp;
      }
      if (tankerSort.key === "direction") {
        const cmp = a.direction.localeCompare(b.direction);
        return tankerSort.dir === "asc" ? cmp : -cmp;
      }
      const cmp = +new Date(a.t) - +new Date(b.t);
      return tankerSort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, selectedTankerHour, tankerSort, crossingWindow, crossingDirectionFilter]);

  const cargoTableRows = useMemo(() => {
    if (!data) return [] as CrossingEvent[];
    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const tableWindowHours = crossingWindow === "all" ? null : Number.parseInt(crossingWindow, 10);
    const cutoff = tableWindowHours == null ? null : latestTs - tableWindowHours * 60 * 60 * 1000;
    const rows = (data.crossingEvents || []).filter((e) => {
      if (e.vesselType !== "cargo") return false;
      if (crossingDirectionFilter !== "all" && e.direction !== crossingDirectionFilter) return false;
      if (cutoff != null) {
        const ts = +new Date(e.t);
        if (ts < cutoff || ts > latestTs) return false;
      }
      return true;
    });
    const filtered = selectedCargoHour ? rows.filter((e) => e.hour === selectedCargoHour) : rows;
    return [...filtered].sort((a, b) => {
      if (cargoSort.key === "ship") {
        const cmp = a.shipName.localeCompare(b.shipName);
        return cargoSort.dir === "asc" ? cmp : -cmp;
      }
      if (cargoSort.key === "direction") {
        const cmp = a.direction.localeCompare(b.direction);
        return cargoSort.dir === "asc" ? cmp : -cmp;
      }
      const cmp = +new Date(a.t) - +new Date(b.t);
      return cargoSort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, selectedCargoHour, cargoSort, crossingWindow, crossingDirectionFilter]);

  const jaskTankerTableRows = useMemo(() => {
    const rows = jaskEvents.filter((e) => e.vesselType === "tanker");
    return (selectedJaskTankerHour ? rows.filter((e) => e.hour === selectedJaskTankerHour) : rows)
      .sort((a, b) => +new Date(b.t) - +new Date(a.t));
  }, [jaskEvents, selectedJaskTankerHour]);

  const jaskCargoTableRows = useMemo(() => {
    const rows = jaskEvents.filter((e) => e.vesselType === "cargo");
    return (selectedJaskCargoHour ? rows.filter((e) => e.hour === selectedJaskCargoHour) : rows)
      .sort((a, b) => +new Date(b.t) - +new Date(a.t));
  }, [jaskEvents, selectedJaskCargoHour]);

  const last24hCrossingCounts = useMemo(() => {
    if (!data?.crossingEvents?.length) return { tanker: 0, cargo: 0, other: 0 };

    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const cutoff = latestTs - 24 * 60 * 60 * 1000;

    const tankerIds = new Set<string>();
    const cargoIds = new Set<string>();
    const otherIds = new Set<string>();

    for (const e of data.crossingEvents) {
      const ts = +new Date(e.t);
      if (ts < cutoff || ts > latestTs) continue;
      if (e.vesselType === "tanker") tankerIds.add(e.shipId);
      else if (e.vesselType === "cargo") cargoIds.add(e.shipId);
      else otherIds.add(e.shipId);
    }

    return {
      tanker: tankerIds.size,
      cargo: cargoIds.size,
      other: otherIds.size,
    };
  }, [data]);

  const crossingWindowHours = crossingWindow === "all" ? null : Number.parseInt(crossingWindow, 10);

  const filteredCrossingEvents = useMemo(() => {
    if (!data) return [] as CrossingEvent[];
    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const cutoff = crossingWindowHours == null ? null : latestTs - crossingWindowHours * 60 * 60 * 1000;
    return (data.crossingEvents || []).filter((e) => {
      if (!crossingMapTypes.includes(e.vesselType)) return false;
      if (crossingDirectionFilter !== "all" && e.direction !== crossingDirectionFilter) return false;
      if (cutoff != null) {
        const ts = +new Date(e.t);
        if (ts < cutoff || ts > latestTs) return false;
      }
      return true;
    });
  }, [data, crossingMapTypes, crossingDirectionFilter, crossingWindowHours]);

  useEffect(() => {
    if (!data?.crossingEvents?.length) return;
    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const cutoff24 = latestTs - 24 * 60 * 60 * 1000;
    const last24hIds = [...new Set((data.crossingEvents || [])
      .filter((e) => {
        if (!crossingMapTypes.includes(e.vesselType)) return false;
        if (crossingDirectionFilter !== "all" && e.direction !== crossingDirectionFilter) return false;
        const ts = +new Date(e.t);
        return ts >= cutoff24 && ts <= latestTs;
      })
      .map((e) => e.shipId))];

    if (!crossingDefaultsAppliedRef.current) {
      setSelectedCrossingShipIds(last24hIds);
      crossingDefaultsAppliedRef.current = true;
      return;
    }

    setSelectedCrossingShipIds((prev) => {
      const valid = new Set((data.crossingEvents || []).map((e) => e.shipId));
      const stillValid = prev.filter((id) => valid.has(id));
      if (stillValid.length === 0 && last24hIds.length) return last24hIds;
      return stillValid;
    });
  }, [data, crossingMapTypes, crossingDirectionFilter]);

  const filteredCrossingPathsForMap = useMemo(() => {
    if (!data) return [] as CrossingPath[];
    const visibleShipIds = new Set(filteredCrossingEvents.map((e) => e.shipId));
    return (data.crossingPaths || [])
      .filter((p) => crossingMapTypes.includes(p.vesselType) && visibleShipIds.has(p.shipId))
      .map((p) => ({ ...p, flag: data.shipMeta?.[p.shipId]?.flag || p.flag || "" }));
  }, [data, crossingMapTypes, filteredCrossingEvents]);

  const crossingMapTitle = useMemo(() => {
    if (crossingMapTypes.length === 1 && crossingMapTypes[0] === "tanker") {
      return "Crossing Paths Map — Tankers";
    }
    return `Crossing Paths Map — ${crossingMapTypes.length ? crossingMapTypes.join(" + ") : "None selected"}`;
  }, [crossingMapTypes]);

  const linkageRows = useMemo(() => {
    if (!data?.linkageEvents?.length) return [] as LinkageEvent[];
    const filtered = data.linkageEvents.filter((r) => selectedTypes.includes(r.vesselType));
    return [...filtered]
      .sort((a, b) => {
        if (linkSort.key === "ship") {
          const cmp = a.shipName.localeCompare(b.shipName);
          return linkSort.dir === "asc" ? cmp : -cmp;
        }
        if (linkSort.key === "type") {
          const cmp = a.vesselType.localeCompare(b.vesselType);
          return linkSort.dir === "asc" ? cmp : -cmp;
        }
        if (linkSort.key === "transit") {
          const cmp = a.deltaHours - b.deltaHours;
          return linkSort.dir === "asc" ? cmp : -cmp;
        }
        const cmp = +new Date(a.hormuzWestTime) - +new Date(b.hormuzWestTime);
        return linkSort.dir === "asc" ? cmp : -cmp;
      })
      .slice(0, 800);
  }, [data, selectedTypes, linkSort]);

  const externalRegions = ["suez", "malacca", "cape_good_hope", "yemen_channel", "south_sri_lanka", "mumbai"];

  const externalLinkRows = useMemo(
    () => linkageRows.filter((r) => externalRegions.includes(r.otherRegion)),
    [linkageRows],
  );

  const crossingVisibleShipIds = useMemo(() => new Set(filteredCrossingPathsForMap.map((p) => p.shipId)), [filteredCrossingPathsForMap]);

  const crossingMapLinkLines = useMemo(() => {
    return externalLinkRows
      .filter((r) => crossingVisibleShipIds.has(r.shipId))
      .slice(0, 300)
      .map((r) => ({
        shipId: r.shipId,
        shipName: r.shipName,
        flag: data?.shipMeta?.[r.shipId]?.flag || r.flag || "",
        fromRegion: r.fromRegion,
        toRegion: r.toRegion,
        fromLat: r.hormuzWestLat,
        fromLon: r.hormuzWestLon,
        toLat: r.otherLat,
        toLon: r.otherLon,
        deltaDh: r.deltaDh,
      }));
  }, [externalLinkRows, crossingVisibleShipIds, data]);

  const crossingSummary = useMemo(() => {
    const uniqueShipIds = new Set(filteredCrossingEvents.map((e) => e.shipId));
    return {
      crossings: filteredCrossingEvents.length,
      ships: uniqueShipIds.size,
    };
  }, [filteredCrossingEvents]);

  const transitTimeByShip = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of linkageRows) {
      if (!map.has(r.shipId)) map.set(r.shipId, r.deltaDh);
    }
    return map;
  }, [linkageRows]);

  const crossingDetailRows = useMemo(() => {
    return [...filteredCrossingEvents].sort((a, b) => {
      let cmp = 0;
      switch (crossingDetailSort.key) {
        case "ship":
          cmp = a.shipName.localeCompare(b.shipName);
          break;
        case "type":
          cmp = a.vesselType.localeCompare(b.vesselType);
          break;
        case "direction":
          cmp = a.direction.localeCompare(b.direction);
          break;
        case "transit":
          cmp = (transitTimeByShip.get(a.shipId) || "").localeCompare(transitTimeByShip.get(b.shipId) || "");
          break;
        case "timestamp":
        default:
          cmp = +new Date(a.t) - +new Date(b.t);
          break;
      }
      return crossingDetailSort.dir === "asc" ? cmp : -cmp;
    });
  }, [filteredCrossingEvents, crossingDetailSort, transitTimeByShip]);

  const candidateTableRows = useMemo(() => {
    const rank = { high: 2, low: 1, no: 0 } as const;
    return [...candidateCrossers, ...cargoCandidateCrossers].sort((a, b) => {
      let cmp = 0;
      switch (candidateSort.key) {
        case "ship":
          cmp = a.shipName.localeCompare(b.shipName);
          break;
        case "lastSeen":
          cmp = +new Date(a.lastSeenAt) - +new Date(b.lastSeenAt);
          break;
        case "darkHours":
          cmp = a.darkHours - b.darkHours;
          break;
        case "alignedPoints":
          cmp = a.alignedPoints - b.alignedPoints;
          break;
        case "speedQuality":
          cmp = a.speedQuality - b.speedQuality;
          break;
        case "approachConfidence":
          cmp = a.approachConfidence - b.approachConfidence;
          break;
        case "score":
          cmp = a.score - b.score;
          break;
        case "confidence": {
          const confidenceCmp = rank[a.confidenceBand] - rank[b.confidenceBand];
          if (confidenceCmp !== 0) {
            cmp = confidenceCmp;
            break;
          }
          cmp = +new Date(a.lastSeenAt) - +new Date(b.lastSeenAt);
          break;
        }
      }
      return candidateSort.dir === "asc" ? cmp : -cmp;
    });
  }, [candidateCrossers, cargoCandidateCrossers, candidateSort]);

  const playbackLinkedPoints = useMemo(() => {
    if (!externalPoints?.length || !currentSnapshot?.t || !data?.snapshots?.length) {
      return [] as { shipId: string; shipName: string; vesselType: string; region: string; lat: number; lon: number; deltaDh: string }[];
    }

    const MAX_FRAME_DELTA_MS = 30 * 60 * 1000;
    const hormuzFrameTimes = data.snapshots.map((s) => s.t);
    const hormuzFrameEpochs = hormuzFrameTimes.map((t) => +new Date(t));

    // Group external points by region+snapshot time first.
    const grouped = new Map<string, ExternalPresencePoint[]>();
    for (const p of externalPoints) {
      if (showOnlyLinkedExternal && !p.linkedToHormuz) continue;
      const key = `${p.region}|${p.t}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    // External -> closest Hormuz frame mapping (with hard 30m cutoff), one best external snapshot per region per frame.
    const frameRegionPick = new Map<string, { points: ExternalPresencePoint[]; deltaMs: number }>();
    for (const [key, points] of grouped.entries()) {
      const [region, t] = key.split("|");
      const ts = +new Date(t);

      let bestIdx = 0;
      let bestDelta = Math.abs(hormuzFrameEpochs[0] - ts);
      for (let i = 1; i < hormuzFrameEpochs.length; i++) {
        const d = Math.abs(hormuzFrameEpochs[i] - ts);
        if (d < bestDelta) {
          bestDelta = d;
          bestIdx = i;
        }
      }

      if (bestDelta > MAX_FRAME_DELTA_MS) continue;

      const frameKey = `${hormuzFrameTimes[bestIdx]}|${region}`;
      const prev = frameRegionPick.get(frameKey);
      if (!prev || bestDelta < prev.deltaMs) {
        frameRegionPick.set(frameKey, { points, deltaMs: bestDelta });
      }
    }

    const out: { shipId: string; shipName: string; vesselType: string; region: string; lat: number; lon: number; deltaDh: string }[] = [];
    for (const region of externalRegions) {
      const pick = frameRegionPick.get(`${currentSnapshot.t}|${region}`);
      if (!pick) continue;
      for (const p of pick.points) {
        if (!selectedTypes.includes(p.vesselType)) continue;
        out.push({
          shipId: p.shipId,
          shipName: p.shipName,
          vesselType: p.vesselType,
          region: p.region,
          lat: p.lat,
          lon: p.lon,
          deltaDh: p.linkedToHormuz ? "linked" : "not linked",
        });
      }
    }

    return out.slice(0, 4000);
  }, [data, currentSnapshot?.t, showOnlyLinkedExternal, externalPoints, selectedTypes]);

  const freshness = useMemo(() => {
    if (!data) {
      return {
        processedGeneratedAt: new Date(0).toISOString(),
        latestByRegion: {
          hormuz: null,
          suez: null,
          malacca: null,
          cape_good_hope: null,
          yemen_channel: null,
          south_sri_lanka: null,
          mumbai: null,
        } as Record<string, string | null>,
        regionFileCounts: {},
      };
    }

    const latestByRegion: Record<string, string | null> = {
      hormuz: data.snapshots?.length ? data.snapshots[data.snapshots.length - 1].t : null,
      suez: null,
      malacca: null,
      cape_good_hope: null,
      yemen_channel: null,
      south_sri_lanka: null,
      mumbai: null,
      ...(data.metadata as any)?.latestByRegion,
    };

    if (!latestByRegion.suez && externalPoints?.length) {
      for (const p of externalPoints) {
        const prev = latestByRegion[p.region] ? +new Date(latestByRegion[p.region] as string) : 0;
        const cur = +new Date(p.t);
        if (!latestByRegion[p.region] || cur > prev) latestByRegion[p.region] = p.t;
      }
    }

    return {
      processedGeneratedAt: data.metadata.generatedAt,
      latestByRegion,
      regionFileCounts: (data.metadata as any).regionFileCounts || {},
    };
  }, [data, externalPoints]);

  const downloadCrossingsCsv = () => {
    if (!data) return;

    const confirmedRows = data.crossingEvents.map((e) => ({
      sort_date_utc: e.t,
      record_type: "confirmed_crossing",
      confidence: "confirmed",
      ship_type: e.vesselType,
      ship_name: e.shipName,
      ship_id: e.shipId,
      ship_url: `https://www.marinetraffic.com/en/ais/details/ships/shipid:${e.shipId}`,
      event_time_utc: e.t,
      hour_bucket_utc: e.hour,
      direction: e.direction,
      dark_hours: "",
      score: "",
      last_seen_utc: "",
      last_lat: "",
      last_lon: "",
      aligned_points: "",
      speed_quality: "",
      approach_confidence: "",
      notes: "Observed AIS crossing event",
    }));

    const candidateRows = [...candidateCrossers, ...cargoCandidateCrossers]
      .map((c) => ({ 
        sort_date_utc: c.lastSeenAt,
        record_type: "likely_dark_crossing_candidate",
        confidence: "high",
        ship_type: c.vesselType,
        ship_name: c.shipName,
        ship_id: c.shipId,
        ship_url: `https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`,
        event_time_utc: "",
        hour_bucket_utc: "",
        direction: "likely_through_hormuz_dark",
        dark_hours: c.darkHours.toFixed(1),
        score: c.score.toFixed(1),
        last_seen_utc: c.lastSeenAt,
        last_lat: c.lastLat.toFixed(5),
        last_lon: c.lastLon.toFixed(5),
        aligned_points: c.alignedPoints,
        speed_quality: c.speedQuality.toFixed(2),
        approach_confidence: c.approachConfidence.toFixed(2),
        notes: "High-confidence heuristic candidate: approaching strait, dark >6h, no detected U-turn",
      }));

    const jaskRows = jaskEvents.map((e) => ({
      sort_date_utc: e.t,
      record_type: "jask_port_entry",
      confidence: "observed",
      ship_type: e.vesselType,
      ship_name: e.shipName,
      ship_id: e.shipId,
      ship_url: `https://www.marinetraffic.com/en/ais/details/ships/shipid:${e.shipId}`,
      event_time_utc: e.t,
      hour_bucket_utc: e.hour,
      direction: "entering_jask_port_area",
      dark_hours: "",
      score: "",
      last_seen_utc: "",
      last_lat: "",
      last_lon: "",
      aligned_points: "",
      speed_quality: "",
      approach_confidence: "",
      notes: `Observed entry into expanded combined Jask monitoring area centered on ${jaskCenter.lat}, ${jaskCenter.lon}`,
    }));

    const rows = [...confirmedRows, ...candidateRows, ...jaskRows].sort((a, b) => {
      const typeCmp = String(a.ship_type).localeCompare(String(b.ship_type));
      if (typeCmp !== 0) return typeCmp;
      const recordCmp = String(a.record_type).localeCompare(String(b.record_type));
      if (recordCmp !== 0) return recordCmp;
      return +new Date(String(b.sort_date_utc)) - +new Date(String(a.sort_date_utc));
    });

    const generatedAtCompact = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(
      `hormuz-crossings-high-confidence-candidates-and-jask-entries-${generatedAtCompact}.csv`,
      rows.map(({ sort_date_utc, ...row }) => row),
    );
  };

  if (!data) {
    return <main className="min-h-screen bg-slate-950 text-slate-100 p-8">Loading dashboard data...</main>;
  }

  const lastIngestedAt = data.snapshots?.length
    ? data.snapshots[data.snapshots.length - 1].t
    : data.metadata.generatedAt;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur">
          <div className="hidden" data-deploy-marker="deploy-marker-20260307-2324" />
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-emerald-200">
              Last ingested: {new Date(lastIngestedAt).toUTCString()}
            </div>
            <button
              onClick={() => alert(`Data source mode: split-v2 files`)}
              className={`inline-flex items-center rounded-full border px-3 py-1 ${splitMode ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200" : "border-amber-400/40 bg-amber-500/10 text-amber-200"}`}
              title="Click to show data source mode"
            >
              Data source: {splitMode ? "split-v2" : "legacy"}
            </button>

          </div>
          {newDataAvailable ? (
            <div className="mb-3 rounded-lg border border-cyan-300/60 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 flex items-center justify-between gap-3">
              <span>New dashboard data is available. Page will refresh automatically when idle.</span>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-cyan-300/60 px-2 py-1"
              >
                Refresh now
              </button>
            </div>
          ) : null}
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Strait of Hormuz Traffic Intelligence</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
              BLK - SET team
            </div>
            <button
              onClick={() => {
                const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
                if (!bot) {
                  alert('Telegram bot username is not configured yet.');
                  return;
                }

                const proceed = window.confirm(
                  [
                    'How to subscribe to Telegram alerts:',
                    '',
                    '1) Click OK to open the bot.',
                    '2) Open it on the phone where Telegram is installed (or Telegram Desktop/Web).',
                    '3) Press Start in the bot chat.',
                    '4) You are subscribed — no further action needed.',
                  ].join('\n'),
                );
                if (!proceed) return;

                window.open(`https://t.me/${bot}?start=hormuz_alerts`, '_blank');
              }}
              className="inline-flex items-center rounded-xl border border-violet-400/50 bg-violet-500/15 px-3 py-2 text-sm font-semibold text-violet-100"
              title="Subscribe via Telegram bot"
            >
              Telegram alerts — CLICK HERE to sign up
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-300">
            Tanker data is generally more reliable for our purposes because tankers are the vessels most likely to carry oil and gas. Cargo traffic is more frequent, but also a noisier signal.
          </p>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
            <Stat label="Vessels" value={String(data.metadata.shipCount)} />
            <div className="rounded-xl border border-emerald-300/60 bg-emerald-500/10 p-3">
              <div className="text-xs text-emerald-200">Crossing Tankers (last 24h | baseline pre-war: 30/day each way)</div>
              <div className="text-lg font-semibold text-emerald-100">{String(last24hCrossingCounts.tanker)}</div>
              <button
                onClick={() => document.getElementById("crossing-paths")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-emerald-300/60 px-2 py-1 text-[11px] text-emerald-100"
              >
                Jump to crossing tankers map
              </button>
            </div>
            <div className="rounded-xl border border-amber-300/60 bg-amber-500/10 p-3">
              <div className="text-xs text-amber-200">Dark-transit candidates — High confidence (&gt;50, last 24h)</div>
              <div className="text-lg font-semibold text-amber-100">{candidateLast24hHighCount}</div>
              <button
                onClick={() => document.getElementById("candidate-dark-crossers")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-amber-300/60 px-2 py-1 text-[11px] text-amber-100"
              >
                Jump to candidate section
              </button>
            </div>
            <div className="rounded-xl border border-cyan-300/60 bg-cyan-500/10 p-3">
              <div className="text-xs text-cyan-200">Tankers in the Jask port area (last 24h)*</div>
              <div className="text-lg font-semibold text-cyan-100">{String(jaskLast48hCounts.tanker)}</div>
              <div className="mt-1 text-[10px] leading-relaxed text-cyan-100/80">
                * Important because Iran may resume oil operations there, so we monitor this area closely.
              </div>
              <button
                onClick={() => document.getElementById("jask-port")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-cyan-300/60 px-2 py-1 text-[11px] text-cyan-100"
              >
                Jump to Jask section
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={downloadCrossingsCsv}
              className="inline-flex items-center rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100"
              title="Download CSV of confirmed crossings, high-confidence likely dark crossings, and Jask port entries"
            >
              Download CSV — crossings + likely crossings + Jask entries
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Baseline reference: pre-war traffic was roughly 30 tanker crossings per day in each direction.</p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <details>
            <summary className="cursor-pointer select-none text-lg font-medium">FAQ / Method Notes</summary>
            <div className="space-y-3 mt-3">
              <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                <summary className="cursor-pointer select-none font-medium text-slate-100">
                  How do we detect a crossing if a vessel turns its transponder off?
                </summary>
                <p className="mt-3 leading-relaxed">
                  To detect a crossing, a vessel must report AIS at least once while inside the Gulf-side boundary logic. If it later goes dark,
                  the crossing can still be inferred when AIS returns in the Indian Ocean side, Cape of Good Hope route, Suez route, or Strait of
                  Malacca route, because the last known side and next known side imply a side change.
                </p>
              </details>

              <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                <summary className="cursor-pointer select-none font-medium text-slate-100">
                  How often is data refreshed?
                </summary>
                <p className="mt-3 leading-relaxed">
                  Data is refreshed continuously in the background and typically appears on the dashboard with an end-to-end delay of roughly
                  15-30 minutes (capture, sync, processing, and upload cadence combined).
                </p>
              </details>

              <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                <summary className="cursor-pointer select-none font-medium text-slate-100">
                  What are the likely candidate dark crossers?
                </summary>
                <p className="mt-3 leading-relaxed">
                  These are vessels that appear to be approaching the strait, then switch off their transponder for more than 6 hours, and do not
                  show evidence of a U-turn before disappearing. In those cases, we cannot prove the transit directly, but the pattern is consistent
                  with a likely passage through the Strait of Hormuz while dark.
                </p>
              </details>

              <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                <summary className="cursor-pointer select-none font-medium text-slate-100">
                  Are tankers and cargo vessels equally important?
                </summary>
                <p className="mt-3 leading-relaxed">
                  No. We mainly focus on tankers because they are the vessels most directly tied to oil and gas flows. Cargo vessels are more frequent,
                  but they also create a noisier signal, so they are shown for context and comparison rather than being reviewed with the same level of attention.
                </p>
              </details>

              <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                <summary className="cursor-pointer select-none font-medium text-slate-100">
                  Why are we monitoring the Jask port area?
                </summary>
                <p className="mt-3 leading-relaxed">
                  Jask matters because Iran may resume or expand oil operations there, so we monitor the area closely as a possible signal of changing export activity.
                  The dashboard tracks unique tankers and cargo vessels entering the monitored Jask box to help spot early movement.
                </p>
              </details>

              <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                <summary className="cursor-pointer select-none font-medium text-slate-100">
                  Where does the data come from, and what are the limitations?
                </summary>
                <p className="mt-3 leading-relaxed">
                  The dashboard uses publicly reported live AIS transponder data. Limitations include spoofing, delayed reporting, and intentional
                  AIS silence (especially in conflict or high-risk zones). The analysis is robust as long as a vessel switches AIS on at least once
                  inside the Gulf corridor or at linked chokepoints; in practice this captures normal tanker traffic, including known reported voyages
                  (for example the Greek tanker movement reported on the 4th would have been captured). The main blind spot is true ghost activity
                  where AIS stays consistently off.
                </p>
              </details>
            </div>
          </details>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-medium mb-3">Filter by Vessel Type</h2>
          <div className="flex flex-wrap gap-2">
            {data.vesselTypes.map((type) => {
              const active = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() =>
                    setSelectedTypes((prev) =>
                      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
                    )
                  }
                  className={`px-3 py-1.5 rounded-full text-xs border transition ${
                    active
                      ? "bg-cyan-400/20 border-cyan-300 text-cyan-200"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </section>

        <section id="playback-map" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Playback Map (filtered vessels)</h2>
            <div className="flex items-center gap-2 text-sm">
              {splitMode ? (
                <div className="flex items-center gap-1 mr-2">
                  {(["24h", "48h"] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => setPlaybackWindow(w)}
                      className={`rounded-md border px-2 py-1 ${playbackWindow === w ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                onClick={() => setPlaying((v) => !v)}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-slate-400">{currentSnapshot?.t ? new Date(currentSnapshot.t).toUTCString() : "-"}{playbackLoading ? " (loading...)" : ""}</span>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max((data.snapshots?.length || 1) - 1, 0)}
            value={frameIndex}
            onChange={(e) => setFrameIndex(Number(e.target.value))}
            className="w-full"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="font-medium text-slate-200 mr-2">Legend (click to toggle)</span>
            {data.vesselTypes.map((type) => {
              const active = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))}
                  className={`px-2 py-1 rounded border ${active ? "border-slate-200" : "border-slate-700 opacity-50"}`}
                >
                  <span className={`inline-block w-3 h-3 rounded-full ${classForType(type)} mr-2`} />{type}
                </button>
              );
            })}
            <button onClick={() => setShowCrossing((v) => !v)} className={`px-2 py-1 rounded border ${showCrossing ? "border-slate-200" : "border-slate-700 opacity-50"}`}>✕ crossing</button>
            <button onClick={() => setShowNonCrossing((v) => !v)} className={`px-2 py-1 rounded border ${showNonCrossing ? "border-slate-200" : "border-slate-700 opacity-50"}`}>● non-crossing</button>
            <button onClick={() => setLoadAllRegions((v) => !v)} className={`px-2 py-1 rounded border ${loadAllRegions ? "border-amber-300 text-amber-200" : "border-slate-700 text-slate-500"}`}>◎ load all regions: {loadAllRegions ? "on" : "off"}</button>
            <button onClick={() => setShowOnlyLinkedExternal((v) => !v)} className={`px-2 py-1 rounded border ${showOnlyLinkedExternal ? "border-violet-300 text-violet-200" : "border-slate-700 text-slate-500"}`}>◉ display only linked ships: {showOnlyLinkedExternal ? "on" : "off (show all external ships)"}</button>
          </div>

          <div className="h-[460px] rounded-xl overflow-hidden border border-slate-800">
            <PlaybackMap
              points={filteredCurrentPoints}
              snapshots={data.snapshots || []}
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
              crossingShipIds={crossingShipIds}
              candidateShipIds={candidateShipIds}
              showCrossing={showCrossing}
              showNonCrossing={showNonCrossing}
              linkedPoints={playbackLinkedPoints}
              currentTimestamp={currentSnapshot?.t}
              monitoredAreas={[
                { ...jaskPortAnalytics.bounds, color: "#fbbf24", label: "Jask port area" },
                { ...jaskFacilitiesAnalytics.bounds, color: "#38bdf8", label: "Jask facilities area" },
              ]}
            />
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="xl:col-span-2 rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
            <strong>Tankers</strong> are the vessels most likely to carry oil and gas. <strong>Cargo vessels</strong> are far less likely to be energy carriers.
            <div className="mt-2 text-amber-50"><strong>BASELINE (pre-war):</strong> about <strong>30 tankers/day each way</strong>.</div>
          </div>
          <div className="xl:col-span-2 flex flex-wrap gap-2 text-xs">
            <button onClick={() => setShowEastToWest((v) => !v)} className={`px-2 py-1 rounded border ${showEastToWest ? "border-sky-300 text-sky-200" : "border-slate-700 text-slate-500"}`}>East → West</button>
            <button onClick={() => setShowWestToEast((v) => !v)} className={`px-2 py-1 rounded border ${showWestToEast ? "border-orange-300 text-orange-200" : "border-slate-700 text-slate-500"}`}>West → East</button>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-lg font-medium mb-3">Crossings in 6-hour bins — Tanker</h2>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tankerSixHour}
                  onClick={(state: any) => {
                    if (state?.activeLabel) setSelectedTankerHour(state.activeLabel as string);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="hour"
                    ticks={chartTicks}
                    tickFormatter={(v) => formatHourTick(v as string)}
                    minTickGap={40}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip labelFormatter={(v) => new Date(v as string).toUTCString()} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                  <Legend />
                  {showEastToWest ? <Bar dataKey="east_to_west" fill="#38bdf8" name="East → West" /> : null}
                  {showWestToEast ? <Bar dataKey="west_to_east" fill="#f97316" name="West → East" /> : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 text-xs text-slate-300">
              <div className="font-medium text-slate-200">
                {selectedTankerHour ? `Clicked hour: ${new Date(selectedTankerHour).toUTCString()}` : "Click a tanker bar to list ship names"}
              </div>
              {selectedTankerHour ? (
                tankerNamesAtSelectedHour.length ? (
                  <ul className="mt-2 space-y-1">
                    {tankerNamesAtSelectedHour.map((r) => (
                      <li key={`${r.shipId}-${r.direction}`}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a> — {r.direction.replace("_to_", " → ")}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-slate-400">No tanker crossings in this hour.</div>
                )
              ) : null}
            </div>
            <div className="mt-4 max-h-56 overflow-auto border border-slate-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Sel</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setTankerSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Tanker ship</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setTankerSort((s) => ({ key: "direction", dir: s.key === "direction" && s.dir === "asc" ? "desc" : "asc" }))}>Direction</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setTankerSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing timestamp (UTC)</th>
                    <th className="text-left p-2">Transit time</th>
                  </tr>
                </thead>
                <tbody>
                  {tankerTableRows.map((r, idx) => {
                    const selected = selectedCrossingShipIds.includes(r.shipId);
                    return (
                    <tr
                      key={`${r.shipId}-${r.t}-${idx}`}
                      className={`border-t border-slate-800 cursor-pointer ${selected ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}
                      onClick={() => {
                        setSelectedCrossingShipIds((prev) => prev.includes(r.shipId) ? prev.filter((id) => id !== r.shipId) : [...prev, r.shipId]);
                        document.getElementById("crossing-paths")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <td className="p-2">{selected ? "●" : "○"}</td>
                      <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a></td>
                      <td className="p-2">{r.direction.replace("_to_", " → ")}</td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
                      <td className="p-2">{transitTimeByShip.get(r.shipId) || "-"}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-lg font-medium mb-3">Crossings in 6-hour bins — Cargo</h2>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={cargoSixHour}
                  onClick={(state: any) => {
                    if (state?.activeLabel) setSelectedCargoHour(state.activeLabel as string);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="hour"
                    ticks={chartTicks}
                    tickFormatter={(v) => formatHourTick(v as string)}
                    minTickGap={40}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip labelFormatter={(v) => new Date(v as string).toUTCString()} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                  <Legend />
                  {showEastToWest ? <Bar dataKey="east_to_west" fill="#38bdf8" name="East → West" /> : null}
                  {showWestToEast ? <Bar dataKey="west_to_east" fill="#f97316" name="West → East" /> : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 text-xs text-slate-300">
              <div className="font-medium text-slate-200">
                {selectedCargoHour ? `Clicked hour: ${new Date(selectedCargoHour).toUTCString()}` : "Click a cargo bar to list ship names"}
              </div>
              {selectedCargoHour ? (
                cargoNamesAtSelectedHour.length ? (
                  <ul className="mt-2 space-y-1">
                    {cargoNamesAtSelectedHour.map((r) => (
                      <li key={`${r.shipId}-${r.direction}`}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a> — {r.direction.replace("_to_", " → ")}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-slate-400">No cargo crossings in this hour.</div>
                )
              ) : null}
            </div>
            <div className="mt-4 max-h-56 overflow-auto border border-slate-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-900 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Sel</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setCargoSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Cargo ship</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setCargoSort((s) => ({ key: "direction", dir: s.key === "direction" && s.dir === "asc" ? "desc" : "asc" }))}>Direction</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setCargoSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing timestamp (UTC)</th>
                    <th className="text-left p-2">Transit time</th>
                  </tr>
                </thead>
                <tbody>
                  {cargoTableRows.map((r, idx) => {
                    const selected = selectedCrossingShipIds.includes(r.shipId);
                    return (
                    <tr
                      key={`${r.shipId}-${r.t}-${idx}`}
                      className={`border-t border-slate-800 cursor-pointer ${selected ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}
                      onClick={() => {
                        setSelectedCrossingShipIds((prev) => prev.includes(r.shipId) ? prev.filter((id) => id !== r.shipId) : [...prev, r.shipId]);
                        document.getElementById("crossing-paths")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <td className="p-2">{selected ? "●" : "○"}</td>
                      <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a></td>
                      <td className="p-2">{r.direction.replace("_to_", " → ")}</td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
                      <td className="p-2">{transitTimeByShip.get(r.shipId) || "-"}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="crossing-paths" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <h2 className="text-lg font-medium">{crossingMapTitle}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-200 mr-2">Legend (click to toggle)</span>
            {data.vesselTypes.map((type) => {
              const active = crossingMapTypes.includes(type);
              return (
                <button
                  key={`cross-${type}`}
                  onClick={() =>
                    setCrossingMapTypes((prev) =>
                      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
                    )
                  }
                  className={`px-2 py-1 rounded border ${active ? "border-slate-200" : "border-slate-700 opacity-50"}`}
                >
                  <span className={`inline-block w-3 h-3 rounded-full ${classForType(type)} mr-2`} />{type}
                </button>
              );
            })}
            <button onClick={() => setCrossingDirectionFilter("all")} className={`px-2 py-1 rounded border ${crossingDirectionFilter === "all" ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}>all crossings</button>
            <button onClick={() => setCrossingDirectionFilter("east_to_west")} className={`px-2 py-1 rounded border ${crossingDirectionFilter === "east_to_west" ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}>east → west</button>
            <button onClick={() => setCrossingDirectionFilter("west_to_east")} className={`px-2 py-1 rounded border ${crossingDirectionFilter === "west_to_east" ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}>west → east</button>
            {(["24h", "48h", "all"] as const).map((w) => (
              <button key={w} onClick={() => setCrossingWindow(w)} className={`px-2 py-1 rounded border ${crossingWindow === w ? "border-emerald-300 text-emerald-200" : "border-slate-700 text-slate-400"}`}>{w}</button>
            ))}
            <span className="text-slate-400">Selected: {selectedCrossingShipIds.length}</span>
            {selectedCrossingShipIds.length ? <button onClick={() => setSelectedCrossingShipIds([])} className="px-2 py-1 rounded border border-slate-600 text-slate-300">reset selection</button> : null}
          </div>
          <div className="text-xs text-slate-300">
            Showing {crossingSummary.crossings} crossings across {crossingSummary.ships} ships under the current filters.
          </div>
          <div className="h-[560px] rounded-xl overflow-hidden border border-slate-800">
            <CrossingPathsMap
              paths={filteredCrossingPathsForMap.slice(0, 180)}
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
              linkLines={crossingMapLinkLines}
              selectedShipIds={selectedCrossingShipIds}
              onToggleShip={(shipId) => setSelectedCrossingShipIds((prev) => prev.includes(shipId) ? prev.filter((id) => id !== shipId) : [...prev, shipId])}
              onResetSelection={() => setSelectedCrossingShipIds([])}
            />
          </div>
          <p className="text-xs text-slate-400">GPS can be weak in this area, so some points may jump inland. Dots are connected with straight lines, so routes can visually cross land even when ships did not.</p>

          <div className="max-h-[420px] overflow-auto border border-slate-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 sticky top-0">
                <tr>
                  <th className="text-left p-2">Sel</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Ship</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "type", dir: s.key === "type" && s.dir === "asc" ? "desc" : "asc" }))}>Type</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "direction", dir: s.key === "direction" && s.dir === "asc" ? "desc" : "asc" }))}>Direction</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing timestamp (UTC)</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "transit", dir: s.key === "transit" && s.dir === "asc" ? "desc" : "asc" }))}>Transit time</th>
                </tr>
              </thead>
              <tbody>
                {crossingDetailRows.map((r, idx) => {
                  const selected = selectedCrossingShipIds.includes(r.shipId);
                  return (
                    <tr
                      key={`cross-detail-${r.shipId}-${r.t}-${idx}`}
                      className={`border-t border-slate-800 cursor-pointer ${selected ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}
                      onClick={() => setSelectedCrossingShipIds((prev) => prev.includes(r.shipId) ? prev.filter((id) => id !== r.shipId) : [...prev, r.shipId])}
                    >
                      <td className="p-2">{selected ? "●" : "○"}</td>
                      <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a></td>
                      <td className="p-2">{r.vesselType}</td>
                      <td className="p-2">{r.direction.replace("_to_", " → ")}</td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
                      <td className="p-2">{transitTimeByShip.get(r.shipId) || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section id="candidate-dark-crossers" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <h2 className="text-lg font-medium">Candidate Dark Crossers</h2>
          <p className="text-xs text-slate-400">Heuristic shortlist: at least 3 aligned approach points, dark for &gt;6h, speed-plausibility weighted, excluding already observed crossers.</p>
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <button
              className={`px-2 py-1 rounded border ${showOnlySelectedCandidates ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}
              onClick={() => setShowOnlySelectedCandidates((v) => !v)}
            >
              display only selected: {showOnlySelectedCandidates ? "on" : "off"}
            </button>
            <span>Selected: {selectedCandidateShipIds.length}</span>
          </div>
          <div className="h-[520px] rounded-xl overflow-hidden border border-slate-800">
            <CandidatePathsMap
              candidates={candidateCrossersForDisplay
                .filter((c) => !showOnlySelectedCandidates || selectedCandidateShipIdSet.has(c.shipId))
                .map((c) => ({
                  shipId: c.shipId,
                  shipName: c.shipName,
                  flag: data?.shipMeta?.[c.shipId]?.flag,
                  points: c.points,
                  lastSeenAt: c.lastSeenAt,
                  score: c.score,
                  confidenceBand: c.confidenceBand,
                  approachScore: c.approachScore,
                  proximityScore: c.proximityScore,
                  directionScore: c.directionScore,
                  tangentialPenalty: c.tangentialPenalty,
                  cosineTowardness: c.cosineTowardness,
                  darknessScore: c.darknessScore,
                  readinessScore: c.readinessScore,
                  alignedPoints: c.alignedPoints,
                  speedQuality: c.speedQuality,
                  approachConfidence: c.approachConfidence,
                  proximityRaw: c.proximityRaw,
                  approachDirectionRaw: c.approachDirectionRaw,
                  onePointPostAnchoringPenalty: c.onePointPostAnchoringPenalty,
                  lastSegmentKnots: c.lastSegmentKnots,
                  prevSegmentKnots: c.prevSegmentKnots,
                }))}
              selectedShipIds={selectedCandidateShipIds}
              colorSelectedWhenFiltered={showOnlySelectedCandidates}
              onToggleShip={(shipId) =>
                setSelectedCandidateShipIds((prev) =>
                  prev.includes(shipId) ? prev.filter((id) => id !== shipId) : [...prev, shipId],
                )
              }
              onResetSelection={() =>
                setSelectedCandidateShipIds(candidateCrossersForDisplay.filter((c) => c.confidenceBand === "high" && c.darkHours <= 24).map((c) => c.shipId))
              }
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
            />
          </div>
          <div className="max-h-[360px] overflow-auto border border-slate-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 sticky top-0">
                <tr>
                  <th className="text-left p-2">Sel</th>
                  <th className="text-left p-2">Only</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Ship</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "lastSeen", dir: s.key === "lastSeen" && s.dir === "asc" ? "desc" : "asc" }))}>Last seen (UTC)</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "darkHours", dir: s.key === "darkHours" && s.dir === "asc" ? "desc" : "asc" }))}>Dark hours</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "alignedPoints", dir: s.key === "alignedPoints" && s.dir === "asc" ? "desc" : "asc" }))}>Aligned points</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "speedQuality", dir: s.key === "speedQuality" && s.dir === "asc" ? "desc" : "asc" }))}>Speed quality</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "approachConfidence", dir: s.key === "approachConfidence" && s.dir === "asc" ? "desc" : "asc" }))}>Approach confidence</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "score", dir: s.key === "score" && s.dir === "asc" ? "desc" : "asc" }))}>Score</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "confidence", dir: s.key === "confidence" && s.dir === "asc" ? "desc" : "asc" }))}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {candidateTableRows.map((c) => (
                  <tr key={`cand-${c.shipId}`} className="border-t border-slate-800">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selectedCandidateShipIdSet.has(c.shipId)}
                        onChange={() =>
                          setSelectedCandidateShipIds((prev) =>
                            prev.includes(c.shipId) ? prev.filter((id) => id !== c.shipId) : [...prev, c.shipId],
                          )
                        }
                      />
                    </td>
                    <td className="p-2">
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
                        onClick={() => setSelectedCandidateShipIds([c.shipId])}
                      >
                        only
                      </button>
                    </td>
                    <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(c.shipName, data?.shipMeta?.[c.shipId]?.flag)} ({c.shipId})</a></td>
                    <td className="p-2">{new Date(c.lastSeenAt).toUTCString()}</td>
                    <td className="p-2">{c.darkHours.toFixed(1)}</td>
                    <td className="p-2">{c.alignedPoints}</td>
                    <td className="p-2">{c.speedQuality.toFixed(2)}</td>
                    <td className="p-2">{c.approachConfidence.toFixed(2)}</td>
                    <td className="p-2 font-medium">{c.score.toFixed(1)}</td>
                    <td className="p-2">{c.confidenceBand === "high" ? "high" : c.confidenceBand === "low" ? "low" : "no confidence"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-slate-100">Score rationale (candidate dark crossers)</summary>
            <div className="mt-2 space-y-1 leading-relaxed">
              <div><strong>Quick confidence guide:</strong></div>
              <div>- <strong>High confidence</strong>: strong recent approach behavior, physically near Hormuz, and total score above 50.</div>
              <div>- <strong>Low confidence</strong>: some approach evidence, but weaker score, weaker geometry, or farther from the strait.</div>
              <div>- <strong>No confidence</strong>: does not clear the scoring threshold, despite passing the basic dark/evidence gates.</div>
              <div>- <strong>Distance guardrail</strong>: vessels more than 300 km from the strait midpoint are excluded entirely; vessels beyond 150 km cannot be labeled high confidence.</div>
              <div><strong>Total score</strong> = approachScore + proximityScore + directionScore + tangentialPenalty + readinessScore + onePointPostAnchoringPenalty.</div>
              <div><strong>Universe filter:</strong> tankers only; vessels with observed confirmed crossing are excluded.</div>
              <div><strong>Minimum evidence gate:</strong> at least 3 aligned approach points in the tail window.</div>
              <div><strong>Darkness filter gate:</strong> candidate must be dark for more than 6 hours (darkHours &gt; 6); darkness is not scored.</div>
              <div><strong>Tail window:</strong> up to last 6 visible points before disappearance.</div>
              <div><strong>alignedPoints</strong>: count of tail points showing movement toward strait midpoint (centerLat + centerLon).</div>
              <div><strong>Segment speed estimation:</strong> haversine distance / time delta, converted to knots.</div>
              <div><strong>speedQuality per segment:</strong> &lt;3 kn =&gt; 0.2 (loiter/anchored candidate), 3-23 kn =&gt; 1.0, 23-30 kn =&gt; 0.5, &gt;30 kn =&gt; 0.1.</div>
              <div><strong>speedQuality</strong>: average of segment speedQuality over tail segments.</div>
              <div><strong>approachConfidence</strong> = min(1, (alignedPoints / max(3, tailLength)) × speedQuality).</div>
              <div><strong>approachScore</strong> = approachConfidence × 55.</div>
              <div><strong>proximityRaw</strong> = 1 - min(1, distanceKm(lastPoint, midpoint) / 160).</div>
              <div><strong>proximityScore</strong> = proximityRaw × 20.</div>
              <div><strong>approachDirectionRaw</strong>: normalized signed change in distance to midpoint between last two points.</div>
              <div>If positive, vessel disappeared while still moving toward the strait (boost). If negative, moving away (penalty).</div>
              <div><strong>directionScore</strong>: if approachDirectionRaw &gt; 0 then ×25; else ×20 (negative score).</div>
              <div><strong>cosineTowardness</strong>: mean cos(theta) toward midpoint over tail segments (1 = directly toward, 0 = perpendicular).</div>
              <div><strong>tangentialPenalty</strong>: applied when approachDirectionRaw is positive, = -(1 - cosineTowardness) × 12.</div>
              <div><strong>readinessScore</strong> (disappearance readiness):</div>
              <div>- if lastSegmentKnots &lt; 2 and direction not toward midpoint =&gt; -12 penalty.</div>
              <div>- if lastSegmentKnots &ge; 4 and accelerating vs previous segment and toward midpoint =&gt; +4 bonus.</div>
              <div><strong>lastSegmentKnots</strong> / <strong>prevSegmentKnots</strong>: speeds on the final two pre-disappearance segments.</div>
              <div><strong>onePointPostAnchoringPenalty</strong>: if vessel has anchor-like history (&lt;2 kn) and only one post-anchor segment before disappearance, apply -6.</div>
              <div><strong>darkHours</strong>: hours since last seen (using latest snapshot time), used only as a strict filter (&gt; 6h).</div>
            </div>
          </details>
        </section>

        <section id="jask-port" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <h2 className="text-lg font-medium">Jask Port Area Monitoring</h2>
          <p className="text-xs text-slate-400">We count unique tanker vessels entering the combined Jask monitoring area. This starts from the main Jask port box and also includes the nearby facilities area. Bounds used: lat {jaskAnalytics.bounds.minLat.toFixed(4)} to {jaskAnalytics.bounds.maxLat.toFixed(4)}, lon {jaskAnalytics.bounds.minLon.toFixed(4)} to {jaskAnalytics.bounds.maxLon.toFixed(4)}.</p>

          <div className="grid grid-cols-1 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <h3 className="text-lg font-medium mb-3">Jask entries in 6-hour bins — Tanker</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={jaskTankerSixHour}
                    onClick={(state: any) => {
                      if (state?.activeLabel) setSelectedJaskTankerHour(state.activeLabel as string);
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis
                      dataKey="hour"
                      ticks={jaskChartTicks}
                      tickFormatter={(v) => formatHourTick(v as string)}
                      minTickGap={40}
                      angle={-35}
                      textAnchor="end"
                      height={56}
                      tick={{ fontSize: 11 }}
                      stroke="#94a3b8"
                    />
                    <YAxis stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip labelFormatter={(v) => new Date(v as string).toUTCString()} contentStyle={{ background: "#020617", border: "1px solid #334155" }} />
                    <Legend />
                    <Bar dataKey="east_to_west" fill="#06b6d4" name="Entries" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 text-xs text-slate-300">
                <div className="font-medium text-slate-200">
                  {selectedJaskTankerHour ? `Clicked hour: ${new Date(selectedJaskTankerHour).toUTCString()}` : "Click a Jask tanker bar to list ship names"}
                </div>
                {selectedJaskTankerHour ? (
                  jaskTankerNamesAtSelectedHour.length ? (
                    <ul className="mt-2 space-y-1">
                      {jaskTankerNamesAtSelectedHour.map((r) => (
                        <li key={r.shipId}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a></li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-slate-400">No tanker entries in this 6-hour window.</div>
                  )
                ) : null}
              </div>
              <div className="mt-4 max-h-56 overflow-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Tanker ship</th>
                      <th className="text-left p-2">Entry timestamp (UTC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jaskTankerTableRows.map((r, idx) => (
                      <tr key={`${r.shipId}-${r.t}-${idx}`} className="border-t border-slate-800">
                        <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a></td>
                        <td className="p-2">{new Date(r.t).toUTCString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          <div className="h-[560px] rounded-xl overflow-hidden border border-slate-800">
            <PortAreaPathsMap
              paths={jaskPaths}
              centerLat={(jaskPortAnalytics.bounds.minLat + jaskFacilitiesAnalytics.bounds.maxLat) / 2}
              centerLon={(jaskPortAnalytics.bounds.maxLon + jaskFacilitiesAnalytics.bounds.minLon) / 2}
              minLat={jaskPortAnalytics.bounds.minLat}
              maxLat={jaskPortAnalytics.bounds.maxLat}
              minLon={jaskPortAnalytics.bounds.minLon}
              maxLon={jaskPortAnalytics.bounds.maxLon}
              title="Jask port area"
              extraAreas={[{ ...jaskFacilitiesAnalytics.bounds, title: "Jask facilities area", color: "#38bdf8" }]}
            />
          </div>
          <p className="text-xs text-slate-400">This map shows trajectories for vessels that entered either Jask monitored area within the loaded monitoring window.</p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Newsfeed MVP</div>
              <h2 className="mt-1 text-xl font-semibold text-slate-100">External narrative and analyst colour</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                A lightweight intelligence layer for commentary, screenshots, blogs, and headline flow sitting on top of the observed AIS crossing data.
              </p>
            </div>
            <div className="text-xs text-slate-400 md:text-right">
              <div>Profile: {newsFeed?.metadata?.profile || "hormuz-news"}</div>
              <div>Items loaded: {newsFeed?.metadata?.itemCount ?? 0}</div>
              <div>New this run: {newsFeed?.metadata?.newItemCount ?? 0}</div>
              <div>Last run: {newsFeed?.metadata?.lastRunAt ? new Date(newsFeed.metadata.lastRunAt).toUTCString() : "Not available yet"}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_0.7fr]">
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">Last update summary</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{newsFeed?.lastUpdateSummary?.headline || "No last-update summary yet"}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {newsFeed?.lastUpdateSummary?.body || "The latest run summary will appear here once the next browsing cycle writes it."}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Last 24h summary</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{newsFeed?.last24hSummary?.headline || "No 24h summary yet"}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {newsFeed?.last24hSummary?.body || "The rolling 24-hour view will appear here once enough collected items exist."}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Tracked sources</div>
              <div className="mt-3 space-y-2">
                {(newsFeed?.sources || []).slice(0, 6).map((source) => (
                  <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-700 hover:bg-slate-900/70">
                    <div>
                      <div className="font-medium text-slate-100">{source.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{source.type.replaceAll("_", " ")}</div>
                    </div>
                    <div className="text-[11px] text-slate-500">P{source.priority}</div>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {(newsFeed?.items || []).length ? (newsFeed?.items || []).map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                      <span>{item.sourceName}</span>
                      {item.isNew ? <span className="rounded-full border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-[10px] text-emerald-300">New in last run</span> : null}
                    </div>
                    <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block text-base font-semibold text-slate-100 hover:text-cyan-300">{item.title}</a>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{new Date(item.publishedAt).toUTCString()}</div>
                    {item.isNew && item.lastRunAt ? <div className="mt-1 text-emerald-300">Added {new Date(item.lastRunAt).toUTCString()}</div> : null}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.summary}</p>
                {item.figureNote ? <p className="mt-3 rounded-lg border border-cyan-900/40 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100">Figure note: {item.figureNote}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span key={`${item.id}-${tag}`} className="rounded-full border border-slate-700 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">{tag}</span>
                  ))}
                </div>
              </article>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-4 text-sm text-slate-400">
                No news items yet. Once a manual or automated browsing run publishes <code className="text-slate-300">/data/news_feed.json</code>, this section will populate automatically.
              </div>
            )}
          </div>
        </section>

        <details className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
          <summary className="cursor-pointer select-none text-slate-300">Pipeline freshness diagnostics</summary>
          <div className="mt-2 space-y-1">
            <div>Processed generated at: {new Date(freshness.processedGeneratedAt).toUTCString()}</div>
            {[
              ["hormuz", "Hormuz"],
              ["suez", "Suez"],
              ["malacca", "Malacca"],
              ["cape_good_hope", "Cape of Good Hope"],
              ["yemen_channel", "Yemen Channel"],
              ["south_sri_lanka", "South Sri Lanka"],
              ["mumbai", "Mumbai"],
            ].map(([key, label]) => (
              <div key={key}>Latest {label}: {freshness.latestByRegion[key] ? new Date(freshness.latestByRegion[key] as string).toUTCString() : "-"}</div>
            ))}
            <div>
              Region file counts: {Object.entries(freshness.regionFileCounts || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}=${v ?? 0}`)
                .join(", ")}
            </div>
          </div>
        </details>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
