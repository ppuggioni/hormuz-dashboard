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
  readinessScore: number;
  onePointPostAnchoringPenalty: number;
  lastSegmentKnots: number;
  prevSegmentKnots: number;
  lastSeenAt: string;
  lastLat: number;
  lastLon: number;
  points: PathPoint[];
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
  shipMeta: Record<string, { shipName: string; vesselType: string }>;
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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function Page() {
  const [data, setData] = useState<DataShape | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [selectedTankerHour, setSelectedTankerHour] = useState<string | null>(null);
  const [selectedCargoHour, setSelectedCargoHour] = useState<string | null>(null);
  const [showEastToWest, setShowEastToWest] = useState(true);
  const [showWestToEast, setShowWestToEast] = useState(true);
  const [showCrossing, setShowCrossing] = useState(true);
  const [showNonCrossing, setShowNonCrossing] = useState(true);
  const [showOnlyLinkedExternal, setShowOnlyLinkedExternal] = useState(false);
  const [crossingMapTypes, setCrossingMapTypes] = useState<string[]>(["tanker"]);
  const [playbackWindow, setPlaybackWindow] = useState<"24h" | "48h" | "72h" | "all">("24h");
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [externalPoints, setExternalPoints] = useState<ExternalPresencePoint[]>([]);
  const [tankerSort, setTankerSort] = useState<{ key: "ship" | "timestamp"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [cargoSort, setCargoSort] = useState<{ key: "ship" | "timestamp"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [linkSort, setLinkSort] = useState<{ key: "ship" | "type" | "timestamp" | "transit"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [selectedCandidateShipIds, setSelectedCandidateShipIds] = useState<string[]>([]);
  const [showOnlySelectedCandidates, setShowOnlySelectedCandidates] = useState(true);
  const candidateDefaultsAppliedRef = useRef(false);

  useEffect(() => {
    const remoteBase = process.env.NEXT_PUBLIC_HORMUZ_PROCESSED_URL || "/data/processed.json";
    const root = remoteBase.replace(/\/processed\.json(?:\?.*)?$/, "");

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

    const load = async () => {
      try {
        const core = await fetchJson(`${root}/processed_core.json`);
        const paths = await fetchJson(`${root}/processed_paths.json`);
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
        setExternalPoints([]);
        const defaults = ["tanker", "cargo"].filter((t) => normalized.vesselTypes.includes(t));
        setSelectedTypes(defaults.length ? defaults : normalized.vesselTypes);
        setCrossingMapTypes(normalized.vesselTypes.includes("tanker") ? ["tanker"] : defaults.length ? defaults : normalized.vesselTypes);
        return;
      } catch {
        // fallback to legacy monolith
      }

      let json: any = null;
      try {
        json = await fetchJson(remoteBase);
      } catch {
        try {
          json = await fetchJson('/data/processed.json');
        } catch {
          json = null;
        }
      }

      const normalized: DataShape = {
        metadata: json?.metadata || {
          generatedAt: new Date().toISOString(),
          eastLon: 56.4,
          westLon: 56.15,
          minLat: 24,
          fileCount: 0,
          shipCount: 0,
          crossingShipCount: 0,
          crossingEventCount: 0,
        },
        vesselTypes: Array.isArray(json?.vesselTypes) ? json.vesselTypes : [],
        shipMeta: json?.shipMeta || {},
        snapshots: Array.isArray(json?.snapshots) ? json.snapshots : [],
        crossingsByHour: Array.isArray(json?.crossingsByHour) ? json.crossingsByHour : [],
        crossingEvents: Array.isArray(json?.crossingEvents) ? json.crossingEvents : [],
        crossingPaths: Array.isArray(json?.crossingPaths) ? json.crossingPaths : [],
        linkageEvents: Array.isArray(json?.linkageEvents) ? json.linkageEvents : [],
        externalPresencePoints: Array.isArray(json?.externalPresencePoints) ? json.externalPresencePoints : [],
      };

      setSplitMode(false);
      setData(normalized);
      setExternalPoints(Array.isArray(json?.externalPresencePoints) ? json.externalPresencePoints : []);
      const defaults = ["tanker", "cargo"].filter((t) => normalized.vesselTypes.includes(t));
      setSelectedTypes(defaults.length ? defaults : normalized.vesselTypes);
      setCrossingMapTypes(normalized.vesselTypes.includes("tanker") ? ["tanker"] : defaults.length ? defaults : normalized.vesselTypes);
    };

    load();
  }, []);

  useEffect(() => {
    if (!playing || !data?.snapshots?.length) return;
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % data.snapshots.length);
    }, 650);
    return () => clearInterval(id);
  }, [playing, data?.snapshots?.length]);

  useEffect(() => {
    if (!splitMode || !data) return;
    const remoteBase = process.env.NEXT_PUBLIC_HORMUZ_PROCESSED_URL || "/data/processed.json";
    const root = remoteBase.replace(/\/processed\.json(?:\?.*)?$/, "");

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
        const externalJson = await fetchJsonMaybeGzip(`${root}/processed_external_${playbackWindow}.json`);
        const shipmetaJson = await fetchJsonMaybeGzip(`${root}/processed_shipmeta_${playbackWindow}.json`);
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
  }, [splitMode, playbackWindow]);

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

  const candidateCrossers = useMemo(() => {
    if (!data?.snapshots?.length) return [] as CandidateCrosser[];

    const latestTs = +new Date(data.snapshots[data.snapshots.length - 1].t);
    const byShip = new Map<string, { shipName: string; vesselType: string; points: PathPoint[] }>();

    for (const s of data.snapshots) {
      for (const p of s.points) {
        if (p.vesselType !== "tanker") continue;
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
      const segSpeeds: number[] = [];

      for (let i = 1; i < tail.length; i++) {
        const a = tail[i - 1];
        const b = tail[i];
        const distPrev = haversineKm(a.lat, a.lon, centerLat, centerLon);
        const distCur = haversineKm(b.lat, b.lon, centerLat, centerLon);
        if (distCur < distPrev) aligned += 1;

        const dtHours = Math.max((+new Date(b.t) - +new Date(a.t)) / (1000 * 60 * 60), 1 / 60);
        const speedKnots = (haversineKm(a.lat, a.lon, b.lat, b.lon) / dtHours) / 1.852;
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
      const proximityRaw = 1 - Math.min(1, lastMidDistKm / 160);
      const prev = tail[tail.length - 2];
      const lastDist = haversineKm(last.lat, last.lon, centerLat, centerLon);
      const prevDist = haversineKm(prev.lat, prev.lon, centerLat, centerLon);
      const towardDeltaKm = prevDist - lastDist;
      // Positive when disappearing while still moving toward the strait midpoint (lat+lon).
      // Negative when moving away at disappearance.
      const approachDirectionRaw = Math.max(-1, Math.min(1, towardDeltaKm / 8));

      const approachScore = approachConfidence * 55;
      const proximityScore = proximityRaw * 20;
      const directionScore = approachDirectionRaw > 0 ? approachDirectionRaw * 25 : approachDirectionRaw * 20;
      const darknessScore = 0;

      const lastSegmentKnots = segSpeeds.length ? segSpeeds[segSpeeds.length - 1] : 0;
      const prevSegmentKnots = segSpeeds.length > 1 ? segSpeeds[segSpeeds.length - 2] : lastSegmentKnots;
      let readinessScore = 0;
      if (lastSegmentKnots < 2 && approachDirectionRaw <= 0) readinessScore = -12;
      if (lastSegmentKnots >= 4 && lastSegmentKnots > prevSegmentKnots && approachDirectionRaw > 0) readinessScore = 4;

      // If vessel appears to come off anchoring but has only one post-anchoring segment before disappearing,
      // reduce confidence (insufficient sustained underway evidence).
      let onePointPostAnchoringPenalty = 0;
      if (segSpeeds.length >= 2) {
        const anchorLikeCount = segSpeeds.slice(0, -1).filter((v) => v < 2).length;
        const hasAnchorLikeHistory = anchorLikeCount >= 1;
        const hasOnlyOnePostAnchorSegment = segSpeeds[segSpeeds.length - 1] >= 2 && segSpeeds[segSpeeds.length - 2] < 2;
        if (hasAnchorLikeHistory && hasOnlyOnePostAnchorSegment) onePointPostAnchoringPenalty = -6;
      }

      const score = approachScore + proximityScore + directionScore + readinessScore + onePointPostAnchoringPenalty;

      out.push({
        shipId,
        shipName: v.shipName,
        vesselType: v.vesselType,
        score,
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
  }, [data, crossingShipIds]);

  const candidateShipIds = useMemo(() => new Set(candidateCrossers.map((c) => c.shipId)), [candidateCrossers]);
  const candidateLast48hAbove30Count = useMemo(
    () => candidateCrossers.filter((c) => c.darkHours <= 48 && c.score > 30).length,
    [candidateCrossers],
  );
  const selectedCandidateShipIdSet = useMemo(() => new Set(selectedCandidateShipIds), [selectedCandidateShipIds]);

  useEffect(() => {
    const valid = new Set(candidateCrossers.map((c) => c.shipId));
    setSelectedCandidateShipIds((prev) => prev.filter((id) => valid.has(id)));

    if (!candidateDefaultsAppliedRef.current && candidateCrossers.length) {
      setSelectedCandidateShipIds(candidateCrossers.filter((c) => c.score > 30).map((c) => c.shipId));
      candidateDefaultsAppliedRef.current = true;
    }
  }, [candidateCrossers]);

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

  const sharedHours = useMemo(() => {
    if (!data?.crossingEvents?.length) return [] as string[];
    const sorted = [...data.crossingEvents].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
    const start = toHourStartIso(sorted[0].hour);
    const end = toHourStartIso(sorted[sorted.length - 1].hour);
    return buildContinuousHourRange(start, end);
  }, [data]);

  const tankerHourlyAligned = useMemo(() => alignHours(tankerHourly, sharedHours), [tankerHourly, sharedHours]);
  const cargoHourlyAligned = useMemo(() => alignHours(cargoHourly, sharedHours), [cargoHourly, sharedHours]);
  const chartTicks = useMemo(() => buildReadableTicks(sharedHours), [sharedHours]);

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

  const tankerTableRows = useMemo(() => {
    if (!data) return [] as CrossingEvent[];
    const rows = data.crossingEvents.filter((e) => e.vesselType === "tanker");
    const filtered = selectedTankerHour ? rows.filter((e) => e.hour === selectedTankerHour) : rows;
    return [...filtered].sort((a, b) => {
      if (tankerSort.key === "ship") {
        const cmp = a.shipName.localeCompare(b.shipName);
        return tankerSort.dir === "asc" ? cmp : -cmp;
      }
      const cmp = +new Date(a.t) - +new Date(b.t);
      return tankerSort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, selectedTankerHour, tankerSort]);

  const cargoTableRows = useMemo(() => {
    if (!data) return [] as CrossingEvent[];
    const rows = data.crossingEvents.filter((e) => e.vesselType === "cargo");
    const filtered = selectedCargoHour ? rows.filter((e) => e.hour === selectedCargoHour) : rows;
    return [...filtered].sort((a, b) => {
      if (cargoSort.key === "ship") {
        const cmp = a.shipName.localeCompare(b.shipName);
        return cargoSort.dir === "asc" ? cmp : -cmp;
      }
      const cmp = +new Date(a.t) - +new Date(b.t);
      return cargoSort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, selectedCargoHour, cargoSort]);

  const last24hCrossingCounts = useMemo(() => {
    if (!data?.crossingEvents?.length) return { tanker: 0, cargo: 0, other: 0 };

    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const cutoff = latestTs - 48 * 60 * 60 * 1000;

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

  const filteredCrossingPathsForMap = useMemo(() => {
    if (!data) return [] as CrossingPath[];
    return (data.crossingPaths || []).filter((p) => crossingMapTypes.includes(p.vesselType));
  }, [data, crossingMapTypes]);

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

  const externalRegions = ["suez", "malacca", "cape_good_hope", "yemen_channel", "south_sri_lanka"];

  const externalLinkRows = useMemo(
    () => linkageRows.filter((r) => externalRegions.includes(r.otherRegion)),
    [linkageRows],
  );

  const crossingMapLinkLines = useMemo(() => {
    return externalLinkRows.slice(0, 300).map((r) => ({
      shipId: r.shipId,
      shipName: r.shipName,
      fromRegion: r.fromRegion,
      toRegion: r.toRegion,
      fromLat: r.hormuzWestLat,
      fromLon: r.hormuzWestLon,
      toLat: r.otherLat,
      toLon: r.otherLon,
      deltaDh: r.deltaDh,
    }));
  }, [externalLinkRows]);

  const transitTimeByShip = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of linkageRows) {
      if (!map.has(r.shipId)) map.set(r.shipId, r.deltaDh);
    }
    return map;
  }, [linkageRows]);

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
  }, [data, currentSnapshot?.t, showOnlyLinkedExternal, externalPoints]);

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
              onClick={() => alert(`Data source mode: ${splitMode ? "split-v2 files" : "legacy processed.json"}`)}
              className={`inline-flex items-center rounded-full border px-3 py-1 ${splitMode ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200" : "border-amber-400/40 bg-amber-500/10 text-amber-200"}`}
              title="Click to show data source mode"
            >
              Data source: {splitMode ? "split-v2" : "legacy"}
            </button>
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
              className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-500/10 px-3 py-1 text-violet-200"
              title="Subscribe via Telegram bot"
            >
              Sign up for alerts (Telegram)
            </button>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Strait of Hormuz Traffic Intelligence</h1>
          <div className="mt-2 inline-flex items-center rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
            BLK - SET team
          </div>
          <p className="mt-2 text-slate-400 text-sm">
            East boundary {data.metadata.eastLon}, west boundary {data.metadata.westLon}, and latitude floor {data.metadata.minLat ?? 24}. Default selection is Cargo + Tanker.
          </p>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Vessels" value={String(data.metadata.shipCount)} />
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="text-xs text-slate-400">Crossing Tankers (last 48h | baseline pre-war: 30-40/day)</div>
              <div className="text-lg font-semibold">{String(last24hCrossingCounts.tanker)}</div>
              <button
                onClick={() => document.getElementById("crossing-paths")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-slate-700 px-2 py-1 text-[11px]"
              >
                Jump to crossing tankers map
              </button>
            </div>
            <Stat label="Crossing Cargo (last 48h)" value={String(last24hCrossingCounts.cargo)} />
            <div className="rounded-xl border border-violet-300/60 bg-violet-500/10 p-3">
              <div className="text-xs text-violet-200">High-confidence dark-transit tanker candidates (&gt;30 score, last 48h)</div>
              <div className="text-lg font-semibold text-violet-100">{candidateLast48hAbove30Count}</div>
              <button
                onClick={() => document.getElementById("candidate-dark-crossers")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-violet-300/60 px-2 py-1 text-[11px] text-violet-100"
              >
                Jump to candidate section
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">Baseline reference: pre-war traffic was roughly 30-40 tanker crossings per day.</p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-medium mb-3">FAQ / Method Notes</h2>
          <div className="space-y-3">
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
                  {(["24h", "48h", "72h", "all"] as const).map((w) => (
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
            />
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="xl:col-span-2 rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
            <strong>Tankers</strong> are the vessels most likely to carry oil and gas. <strong>Cargo vessels</strong> are far less likely to be energy carriers.
            <div className="mt-2 text-amber-50"><strong>BASELINE (pre-war):</strong> about <strong>30-40 tankers/day</strong>.</div>
          </div>
          <div className="xl:col-span-2 flex flex-wrap gap-2 text-xs">
            <button onClick={() => setShowEastToWest((v) => !v)} className={`px-2 py-1 rounded border ${showEastToWest ? "border-sky-300 text-sky-200" : "border-slate-700 text-slate-500"}`}>East → West</button>
            <button onClick={() => setShowWestToEast((v) => !v)} className={`px-2 py-1 rounded border ${showWestToEast ? "border-orange-300 text-orange-200" : "border-slate-700 text-slate-500"}`}>West → East</button>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-lg font-medium mb-3">Hourly Crossings — Tanker</h2>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tankerHourlyAligned}
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
                      <li key={`${r.shipId}-${r.direction}`}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{r.shipName} ({r.shipId})</a> — {r.direction.replace("_to_", " → ")}</li>
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
                    <th className="text-left p-2 cursor-pointer" onClick={() => setTankerSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Tanker ship</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setTankerSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing timestamp (UTC)</th>
                    <th className="text-left p-2">Transit time</th>
                  </tr>
                </thead>
                <tbody>
                  {tankerTableRows.map((r, idx) => (
                    <tr key={`${r.shipId}-${r.t}-${idx}`} className="border-t border-slate-800">
                      <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{r.shipName} ({r.shipId})</a></td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
                      <td className="p-2">{transitTimeByShip.get(r.shipId) || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-lg font-medium mb-3">Hourly Crossings — Cargo</h2>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={cargoHourlyAligned}
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
                      <li key={`${r.shipId}-${r.direction}`}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{r.shipName} ({r.shipId})</a> — {r.direction.replace("_to_", " → ")}</li>
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
                    <th className="text-left p-2 cursor-pointer" onClick={() => setCargoSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Cargo ship</th>
                    <th className="text-left p-2 cursor-pointer" onClick={() => setCargoSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing timestamp (UTC)</th>
                    <th className="text-left p-2">Transit time</th>
                  </tr>
                </thead>
                <tbody>
                  {cargoTableRows.map((r, idx) => (
                    <tr key={`${r.shipId}-${r.t}-${idx}`} className="border-t border-slate-800">
                      <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{r.shipName} ({r.shipId})</a></td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
                      <td className="p-2">{transitTimeByShip.get(r.shipId) || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="crossing-paths" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <h2 className="text-lg font-medium">{crossingMapTitle}</h2>
          <div className="flex items-center gap-2 text-xs text-slate-300">
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
          </div>
          <div className="h-[560px] rounded-xl overflow-hidden border border-slate-800">
            <CrossingPathsMap
              paths={filteredCrossingPathsForMap.slice(0, 180)}
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
              linkLines={crossingMapLinkLines}
            />
          </div>
          <p className="text-xs text-slate-400">GPS can be weak in this area, so some points may jump inland. Dots are connected with straight lines, so routes can visually cross land even when ships did not.</p>
        </section>

        <section id="candidate-dark-crossers" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <h2 className="text-lg font-medium">Candidate Dark Crossers — Tankers</h2>
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
              candidates={candidateCrossers
                .filter((c) => !showOnlySelectedCandidates || selectedCandidateShipIdSet.has(c.shipId))
                .map((c) => ({
                  shipId: c.shipId,
                  shipName: c.shipName,
                  points: c.points,
                  lastSeenAt: c.lastSeenAt,
                  score: c.score,
                  approachScore: c.approachScore,
                  proximityScore: c.proximityScore,
                  directionScore: c.directionScore,
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
              onToggleShip={(shipId) =>
                setSelectedCandidateShipIds((prev) =>
                  prev.includes(shipId) ? prev.filter((id) => id !== shipId) : [...prev, shipId],
                )
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
                  <th className="text-left p-2">Ship</th>
                  <th className="text-left p-2">Last seen (UTC)</th>
                  <th className="text-left p-2">Dark hours</th>
                  <th className="text-left p-2">Aligned points</th>
                  <th className="text-left p-2">Speed quality</th>
                  <th className="text-left p-2">Approach confidence</th>
                  <th className="text-left p-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {candidateCrossers.map((c) => (
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
                    <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`} target="_blank" rel="noreferrer" className="underline">{c.shipName} ({c.shipId})</a></td>
                    <td className="p-2">{new Date(c.lastSeenAt).toUTCString()}</td>
                    <td className="p-2">{c.darkHours.toFixed(1)}</td>
                    <td className="p-2">{c.alignedPoints}</td>
                    <td className="p-2">{c.speedQuality.toFixed(2)}</td>
                    <td className="p-2">{c.approachConfidence.toFixed(2)}</td>
                    <td className="p-2 font-medium">{c.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-slate-100">Score rationale (candidate dark crossers)</summary>
            <div className="mt-2 space-y-1 leading-relaxed">
              <div><strong>Total score</strong> = approachScore + proximityScore + directionScore + readinessScore + onePointPostAnchoringPenalty.</div>
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
              <div><strong>readinessScore</strong> (disappearance readiness):</div>
              <div>- if lastSegmentKnots &lt; 2 and direction not toward midpoint =&gt; -12 penalty.</div>
              <div>- if lastSegmentKnots &ge; 4 and accelerating vs previous segment and toward midpoint =&gt; +4 bonus.</div>
              <div><strong>lastSegmentKnots</strong> / <strong>prevSegmentKnots</strong>: speeds on the final two pre-disappearance segments.</div>
              <div><strong>onePointPostAnchoringPenalty</strong>: if vessel has anchor-like history (&lt;2 kn) and only one post-anchor segment before disappearance, apply -6.</div>
              <div><strong>darkHours</strong>: hours since last seen (using latest snapshot time), used only as a strict filter (&gt; 6h).</div>
            </div>
          </details>
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
