"use client";

import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useState } from "react";

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
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Strait of Hormuz Traffic Intelligence</h1>
          <div className="mt-2 inline-flex items-center rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
            BLK - SET team
          </div>
          <p className="mt-2 text-slate-400 text-sm">
            East boundary {data.metadata.eastLon}, west boundary {data.metadata.westLon}, and latitude floor {data.metadata.minLat ?? 24}. Default selection is Cargo + Tanker.
          </p>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <Stat label="Files" value={String(data.metadata.fileCount)} />
            <Stat label="Vessels" value={String(data.metadata.shipCount)} />
            <Stat label="Crossing Tankers (last 48h | baseline pre-war: 30-40/day)" value={String(last24hCrossingCounts.tanker)} />
            <Stat label="Crossing Cargo (last 48h)" value={String(last24hCrossingCounts.cargo)} />
            <Stat label="Crossing Others (last 48h)" value={String(last24hCrossingCounts.other)} />
          </div>
          <p className="mt-2 text-xs text-slate-400">Baseline reference: pre-war traffic was roughly 30-40 tanker crossings per day.</p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-medium mb-3">FAQ / Method Notes</h2>
          <details className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            <summary className="cursor-pointer select-none font-medium text-slate-100">
              How do we detect a crossing if a vessel turns its transponder off?
            </summary>
            <p className="mt-3 leading-relaxed">
              To detect a crossing, a vessel must report AIS position at least once while inside the Gulf side of the boundary logic.
              If the vessel then sails with transponder off, we can still detect the crossing once it switches AIS back on in the Indian Ocean side,
              because the latest known side and the new side indicate a side change.
            </p>
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

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
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
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
              crossingShipIds={crossingShipIds}
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
                      <li key={`${r.shipId}-${r.direction}`}>{r.shipName} ({r.shipId}) — {r.direction.replace("_to_", " → ")}</li>
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
                  </tr>
                </thead>
                <tbody>
                  {tankerTableRows.map((r, idx) => (
                    <tr key={`${r.shipId}-${r.t}-${idx}`} className="border-t border-slate-800">
                      <td className="p-2">{r.shipName} ({r.shipId})</td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
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
                      <li key={`${r.shipId}-${r.direction}`}>{r.shipName} ({r.shipId}) — {r.direction.replace("_to_", " → ")}</li>
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
                  </tr>
                </thead>
                <tbody>
                  {cargoTableRows.map((r, idx) => (
                    <tr key={`${r.shipId}-${r.t}-${idx}`} className="border-t border-slate-800">
                      <td className="p-2">{r.shipName} ({r.shipId})</td>
                      <td className="p-2">{new Date(r.t).toUTCString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <h2 className="text-lg font-medium">Detected From → To Regions (anchored on Hormuz West)</h2>
          <p className="text-xs text-slate-400">Transit time is measured from Hormuz West in Dd:HHh:MMm. Positive means after Hormuz West; negative means before.</p>
          <div className="max-h-[420px] overflow-auto border border-slate-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 sticky top-0">
                <tr>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setLinkSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Ship</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setLinkSort((s) => ({ key: "type", dir: s.key === "type" && s.dir === "asc" ? "desc" : "asc" }))}>Type</th>
                  <th className="text-left p-2">From</th>
                  <th className="text-left p-2">To</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setLinkSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Hormuz West (UTC)</th>
                  <th className="text-left p-2">Other Region (UTC)</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setLinkSort((s) => ({ key: "transit", dir: s.key === "transit" && s.dir === "asc" ? "desc" : "asc" }))}>Transit time</th>
                </tr>
              </thead>
              <tbody>
                {linkageRows.map((r, idx) => (
                  <tr key={`${r.shipId}-${r.hormuzWestTime}-${r.otherRegionTime}-${idx}`} className="border-t border-slate-800">
                    <td className="p-2">{r.shipName} ({r.shipId})</td>
                    <td className="p-2">{r.vesselType}</td>
                    <td className="p-2">{r.fromRegion}</td>
                    <td className="p-2">{r.toRegion}</td>
                    <td className="p-2">{new Date(r.hormuzWestTime).toUTCString()}</td>
                    <td className="p-2">{new Date(r.otherRegionTime).toUTCString()}</td>
                    <td className="p-2 font-medium">{r.deltaDh}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
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
