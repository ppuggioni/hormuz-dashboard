"use client";

import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

type SnapshotPoint = { shipId: string; shipName: string; vesselType: string; lat: number; lon: number };
type Snapshot = { t: string; points: SnapshotPoint[] };
type CrossingHour = { hour: string; east_to_west: number; west_to_east: number };
type PathPoint = { t: string; lat: number; lon: number; sourceRegion?: string; zones?: string[] };
type CrossingPath = {
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  primaryDirection: "east_to_west" | "west_to_east" | "mixed";
  directionCounts: { east_to_west: number; west_to_east: number };
  points: PathPoint[];
};

type RedSeaCrossingType = "south_outbound" | "south_inbound" | "north_outbound" | "north_inbound";
type RedSeaVesselType = "tanker" | "cargo";
type RedSeaCrossingDay = {
  day: string;
  south_outbound: number;
  south_inbound: number;
  north_outbound: number;
  north_inbound: number;
  total: number;
};
type RedSeaCrossingEvent = {
  eventId: string;
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  crossingType: RedSeaCrossingType;
  t: string;
  crossingTime: string;
  day: string;
  anchorZone: string;
  anchorTime: string;
  anchorLat: number;
  anchorLon: number;
  anchorSourceRegion?: string;
  priorZone: string;
  priorTime: string;
  priorLat: number;
  priorLon: number;
  priorSourceRegion?: string;
  lookbackHours: number;
  deltaDh?: string;
  sourceRegionsSeen?: string[];
  inferenceWindowDays?: number;
  routePointCount: number;
};
type RedSeaCrossingRoute = {
  eventId: string;
  shipId: string;
  shipName: string;
  vesselType: string;
  flag?: string;
  crossingType: RedSeaCrossingType;
  t: string;
  crossingTime: string;
  day: string;
  anchorZone: string;
  anchorTime: string;
  anchorLat: number;
  anchorLon: number;
  priorZone: string;
  priorTime: string;
  priorLat: number;
  priorLon: number;
  routeWindowHours?: number;
  routeWindowStartTime?: string;
  routeWindowEndTime?: string;
  points: PathPoint[];
};

type CrossingEvent = {
  eventId: string;
  t: string;
  hour: string;
  shipId: string;
  shipName: string;
  vesselType: string;
  direction: "east_to_west" | "west_to_east";
  manuallyExcluded?: boolean;
};

type ConfirmedCrossingExclusion = {
  eventId: string;
  reason: string;
  note?: string;
  excludedAt?: string | null;
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
  inferredDirection: "east_to_west" | "west_to_east";
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
  collectionRule?: string | null;
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

type VesselAttackItem = {
  date: string;
  place: string;
  summary: string;
  kind?: "attack" | "suspicious";
  statusLabel?: string | null;
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
  vesselAttacks24hSummary?: NewsSummary | null;
  vesselAttacksLatest?: VesselAttackItem[];
  previousDaySummary?: NewsSummary | null;
  sources: NewsSource[];
  items: NewsItem[];
};

type VesselAttacksFeedShape = {
  generatedAt: string;
  lastRunAt?: string;
  vesselAttacks24hSummary?: NewsSummary | null;
  items: VesselAttackItem[];
};

type FetchFreshness = "cache" | "revalidate" | "bust";

type CandidateEvent = CandidateCrosser & {
  eventId: string;
  gapHours: number;
  resumedAt?: string | null;
  eventType: "historical_gap" | "open_gap";
  inferredDirection: "east_to_west" | "west_to_east";
};

type CandidatesShape = {
  data?: {
    tankerCandidates?: CandidateCrosser[];
    cargoCandidates?: CandidateCrosser[];
    tankerCandidateEvents?: CandidateEvent[];
    cargoCandidateEvents?: CandidateEvent[];
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
  redSeaCrossingsByDay?: RedSeaCrossingDay[];
  redSeaCrossingEvents?: RedSeaCrossingEvent[];
  redSeaCrossingRoutes?: RedSeaCrossingRoute[];
  linkageEvents?: LinkageEvent[];
  externalPresencePoints?: ExternalPresencePoint[];
  confirmedCrossingExclusions?: ConfirmedCrossingExclusion[];
};

const PlaybackMap = dynamic(() => import("@/components/PlaybackMap"), { ssr: false });
const CrossingPathsMap = dynamic(() => import("@/components/CrossingPathsMap"), { ssr: false });
const CandidatePathsMap = dynamic(() => import("@/components/CandidatePathsMap"), { ssr: false });
const RedSeaCrossingMap = dynamic(() => import("@/components/RedSeaCrossingMap"), { ssr: false });
const EXTERNAL_REGIONS = ["suez", "malacca", "cape_good_hope", "yemen_channel", "south_sri_lanka", "mumbai", "red_sea"] as const;
const RED_SEA_CROSSING_TYPES: RedSeaCrossingType[] = ["south_outbound", "south_inbound", "north_outbound", "north_inbound"];
const RED_SEA_CROSSING_TYPE_LABELS: Record<RedSeaCrossingType, string> = {
  south_outbound: "South outbound",
  south_inbound: "South inbound",
  north_outbound: "North outbound",
  north_inbound: "North inbound",
};
const RED_SEA_CROSSING_CHART_MATRIX: Array<{
  crossingType: RedSeaCrossingType;
  side: "North" | "South";
  flow: "Inbound" | "Outbound";
}> = [
  { crossingType: "north_inbound", side: "North", flow: "Inbound" },
  { crossingType: "south_inbound", side: "South", flow: "Inbound" },
  { crossingType: "north_outbound", side: "North", flow: "Outbound" },
  { crossingType: "south_outbound", side: "South", flow: "Outbound" },
];
const RED_SEA_TOPLINE_GROUPS: Array<{
  key: "north" | "south";
  title: string;
  accentClass: string;
  backgroundClass: string;
  buttonClass: string;
  items: Array<{ crossingType: RedSeaCrossingType; label: string }>;
}> = [
  {
    key: "north",
    title: "Red Sea crossings — North [Tankers]",
    accentClass: "text-sky-200",
    backgroundClass: "border-sky-300/60 bg-sky-500/10",
    buttonClass: "border-sky-300/60 text-sky-100",
    items: [
      { crossingType: "north_inbound", label: "Inbound" },
      { crossingType: "north_outbound", label: "Outbound" },
    ],
  },
  {
    key: "south",
    title: "Red Sea crossings — South [Tankers]",
    accentClass: "text-orange-200",
    backgroundClass: "border-orange-300/60 bg-orange-500/10",
    buttonClass: "border-orange-300/60 text-orange-100",
    items: [
      { crossingType: "south_inbound", label: "Inbound" },
      { crossingType: "south_outbound", label: "Outbound" },
    ],
  },
];
const RED_SEA_VESSEL_TYPES: RedSeaVesselType[] = ["tanker", "cargo"];
const RED_SEA_CROSSING_TYPE_COLORS: Record<RedSeaCrossingType, string> = {
  south_outbound: "#f97316",
  south_inbound: "#22c55e",
  north_outbound: "#38bdf8",
  north_inbound: "#eab308",
};

function formatShipDisplayName(shipName: string, flag?: string | null) {
  const cleanName = String(shipName || "Unknown").trim() || "Unknown";
  const cleanFlag = String(flag || "").trim();
  return cleanFlag ? `${cleanName} [${cleanFlag}]` : cleanName;
}

function deriveNewsDisplaySource(item: NewsItem) {
  const url = item.url || item.canonicalUrl || "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "x.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const account = parts[0];
      return account ? `X: ${account}` : "X";
    }

    const labels: Record<string, string> = {
      "windward.ai": "Windward",
      "maritime-executive.com": "Maritime Executive",
      "theguardian.com": "The Guardian",
      "japantoday.com": "Japan Today",
      "straitstimes.com": "The Straits Times",
      "financialpost.com": "Financial Post",
      "lloydslist.com": "Lloyd's List",
      "kpler.com": "Kpler",
      "fortune.com": "Fortune",
      "hindustantimes.com": "Hindustan Times",
      "hellenicshippingnews.com": "Hellenic Shipping News",
      "hormuzstraitmonitor.com": "Hormuz Strait Monitor",
      "marineindustrynews.co.uk": "Marine Industry News",
      "rivieramm.com": "Riviera",
      "thehindu.com": "The Hindu",
    };

    return labels[host] || item.sourceName || host;
  } catch {
    return item.sourceName || "Unknown source";
  }
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

function aggregateToDailyBins(rows: CrossingHour[]) {
  const out = new Map<string, CrossingHour>();
  for (const r of rows) {
    const d = new Date(r.hour);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!out.has(key)) out.set(key, { hour: key, east_to_west: 0, west_to_east: 0 });
    out.get(key)!.east_to_west += r.east_to_west;
    out.get(key)!.west_to_east += r.west_to_east;
  }
  return [...out.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
}

function toUtcDayIso(ts: string) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function createEmptyRedSeaCrossingDay(day: string): RedSeaCrossingDay {
  return {
    day,
    south_outbound: 0,
    south_inbound: 0,
    north_outbound: 0,
    north_inbound: 0,
    total: 0,
  };
}

function aggregateRedSeaEventsToDailyBins(events: RedSeaCrossingEvent[]) {
  if (!events.length) return [] as RedSeaCrossingDay[];

  const byDay = new Map<string, RedSeaCrossingDay>();
  let minDayMs = Number.POSITIVE_INFINITY;
  let maxDayMs = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    const day = event.day || toUtcDayIso(event.crossingTime || event.t);
    const dayMs = +new Date(day);
    if (!byDay.has(day)) byDay.set(day, createEmptyRedSeaCrossingDay(day));
    const bucket = byDay.get(day)!;
    bucket[event.crossingType] += 1;
    bucket.total += 1;
    if (dayMs < minDayMs) minDayMs = dayMs;
    if (dayMs > maxDayMs) maxDayMs = dayMs;
  }

  const rows: RedSeaCrossingDay[] = [];
  for (let dayMs = minDayMs; dayMs <= maxDayMs; dayMs += 24 * 60 * 60 * 1000) {
    const day = new Date(dayMs).toISOString();
    rows.push(byDay.get(day) || createEmptyRedSeaCrossingDay(day));
  }
  return rows;
}

function isSameUtcDay(ts: string, dayStartIso: string) {
  const a = new Date(ts);
  const b = new Date(dayStartIso);
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function formatDayTick(iso: string) {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function formatUtcTime(iso: string) {
  const d = new Date(iso);
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute} UTC`;
}

function utcDayStartMs(iso: string) {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  return +d;
}

function buildSuspectedOppositeDirectionKeySet<T extends { shipId: string; lastSeenAt: string; inferredDirection: "east_to_west" | "west_to_east" }>(events: T[]) {
  const byShip = new Map<string, T[]>();
  for (const e of events) {
    if (!byShip.has(e.shipId)) byShip.set(e.shipId, []);
    byShip.get(e.shipId)!.push(e);
  }

  const flagged = new Set<string>();
  for (const rows of byShip.values()) {
    const sorted = [...rows].sort((a, b) => +new Date(a.lastSeenAt) - +new Date(b.lastSeenAt));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const dayDiff = Math.abs(utcDayStartMs(a.lastSeenAt) - utcDayStartMs(b.lastSeenAt)) / (24 * 60 * 60 * 1000);
        if (dayDiff > 1) break;
        if (a.inferredDirection !== b.inferredDirection) {
          flagged.add(`${a.shipId}|${a.lastSeenAt}|${a.inferredDirection}`);
          flagged.add(`${b.shipId}|${b.lastSeenAt}|${b.inferredDirection}`);
        }
      }
    }
  }
  return flagged;
}

function buildSuspectedSpoofingEventKeySet(events: CrossingEvent[]) {
  return buildSuspectedOppositeDirectionKeySet(events.map((e) => ({
    shipId: e.shipId,
    lastSeenAt: e.t,
    inferredDirection: e.direction,
  })));
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

function aggregateCandidatesToDailyBins(rows: Array<CandidateCrosser & { inferredDirection?: "east_to_west" | "west_to_east" }>) {
  const out = new Map<string, { hour: string; east_to_west: number; west_to_east: number; count: number }>();
  for (const r of rows) {
    const d = new Date(r.lastSeenAt);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!out.has(key)) out.set(key, { hour: key, east_to_west: 0, west_to_east: 0, count: 0 });
    const row = out.get(key)!;
    row.count += 1;
    if (r.inferredDirection === "east_to_west") row.east_to_west += 1;
    else if (r.inferredDirection === "west_to_east") row.west_to_east += 1;
  }
  return [...out.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
}

function DailyCandidateTooltip({
  active,
  label,
  payload,
  rows,
  shipMeta,
}: {
  active?: boolean;
  label?: string;
  payload?: ReadonlyArray<{ value?: number; name?: string; color?: string }>;
  rows: CandidateEvent[];
  shipMeta?: Record<string, ShipMeta>;
}) {
  if (!active || !label) return null;
  return (
    <div className="max-w-[420px] rounded border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl">
      <div className="font-semibold">{new Date(label).toUTCString()}</div>
      {!!payload?.length && (
        <div className="mt-2 space-y-1">
          {payload.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color || "#94a3b8" }} />
              <span>{item.name}: {item.value ?? 0}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 border-t border-slate-800 pt-2">
        <div className="mb-1 font-medium text-slate-200">High-conviction candidates last seen that day</div>
        {rows.length ? (
          <ul className="max-h-56 space-y-1 overflow-auto pr-1 text-slate-200">
            {rows.map((r) => (
              <li key={r.eventId}>
                {formatShipDisplayName(r.shipName, shipMeta?.[r.shipId]?.flag)} — {formatUtcTime(r.lastSeenAt)} — {r.inferredDirection.replace("_to_", " → ")} — score {r.score.toFixed(1)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-slate-400">No high-conviction candidates that day.</div>
        )}
      </div>
    </div>
  );
}

function DailyCrossingsTooltip({
  active,
  label,
  payload,
  rows,
  shipMeta,
}: {
  active?: boolean;
  label?: string;
  payload?: ReadonlyArray<{ value?: number; name?: string; color?: string }>;
  rows: { shipName: string; shipId: string; direction: string; t: string }[];
  shipMeta?: Record<string, ShipMeta>;
}) {
  if (!active || !label) return null;
  return (
    <div className="max-w-[420px] rounded border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl">
      <div className="font-semibold">{new Date(label).toUTCString()}</div>
      {!!payload?.length && (
        <div className="mt-2 space-y-1">
          {payload.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color || "#94a3b8" }} />
              <span>{item.name}: {item.value ?? 0}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 border-t border-slate-800 pt-2">
        <div className="mb-1 font-medium text-slate-200">Crossings that day</div>
        {rows.length ? (
          <ul className="max-h-56 space-y-1 overflow-auto pr-1 text-slate-200">
            {rows.map((r, idx) => (
              <li key={`${r.shipId}-${r.t}-${idx}`}>
                {formatShipDisplayName(r.shipName, shipMeta?.[r.shipId]?.flag)} — {formatUtcTime(r.t)} — {r.direction.replace("_to_", " → ")}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-slate-400">No crossings that day.</div>
        )}
      </div>
    </div>
  );
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
      inferredDirection: last.lon >= centerLon ? "east_to_west" : "west_to_east",
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


export default function Page() {
  const [data, setData] = useState<DataShape | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedTankerHour, setSelectedTankerHour] = useState<string | null>(null);
  const [selectedCargoHour, setSelectedCargoHour] = useState<string | null>(null);
  const [showEastToWest, setShowEastToWest] = useState(true);
  const [showWestToEast, setShowWestToEast] = useState(true);
  const [showCrossing, setShowCrossing] = useState(true);
  const [showNonCrossing, setShowNonCrossing] = useState(true);
  const [showOnlyLinkedExternal, setShowOnlyLinkedExternal] = useState(false);
  const [loadAllRegions, setLoadAllRegions] = useState(false);
  const [crossingMapTypes, setCrossingMapTypes] = useState<string[]>(["tanker"]);
  const [crossingDirectionFilter, setCrossingDirectionFilter] = useState<"all" | "east_to_west" | "west_to_east">("all");
  const [crossingWindow, setCrossingWindow] = useState<"24h" | "48h" | "all">("all");
  const [discardSuspectedSpoofing, setDiscardSuspectedSpoofing] = useState(true);
  const [hideSpoofingDetectedCrossings, setHideSpoofingDetectedCrossings] = useState(true);
  const [selectedCrossingShipIds, setSelectedCrossingShipIds] = useState<string[]>([]);
  const [playbackWindow, setPlaybackWindow] = useState<"24h" | "48h">("24h");
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackDataMode, setPlaybackDataMode] = useState<"latest" | "24h" | "48h">("latest");
  const [splitMode, setSplitMode] = useState(false);
  const [externalPoints, setExternalPoints] = useState<ExternalPresencePoint[]>([]);
  const [tankerCandidatesData, setTankerCandidatesData] = useState<CandidateCrosser[]>([]);
  const [cargoCandidatesData, setCargoCandidatesData] = useState<CandidateCrosser[]>([]);
  const [tankerCandidateEventsData, setTankerCandidateEventsData] = useState<CandidateEvent[]>([]);
  const [cargoCandidateEventsData, setCargoCandidateEventsData] = useState<CandidateEvent[]>([]);
  const [tankerSort, setTankerSort] = useState<{ key: "ship" | "timestamp" | "direction"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [cargoSort, setCargoSort] = useState<{ key: "ship" | "timestamp" | "direction"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [linkSort, setLinkSort] = useState<{ key: "ship" | "type" | "timestamp" | "transit"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [crossingDetailSort, setCrossingDetailSort] = useState<{ key: "ship" | "type" | "direction" | "timestamp" | "transit"; dir: "asc" | "desc" }>({ key: "timestamp", dir: "desc" });
  const [copiedCrossingEventId, setCopiedCrossingEventId] = useState<string | null>(null);
  const [selectedCandidateShipIds, setSelectedCandidateShipIds] = useState<string[]>([]);
  const [showOnlySelectedCandidates, setShowOnlySelectedCandidates] = useState(true);
  const [candidateSort, setCandidateSort] = useState<{ key: "ship" | "lastSeen" | "darkHours" | "alignedPoints" | "speedQuality" | "approachConfidence" | "score" | "confidence"; dir: "asc" | "desc" }>({ key: "confidence", dir: "desc" });
  const [newsFeed, setNewsFeed] = useState<NewsFeedShape | null>(null);
  const [attacksFeed, setAttacksFeed] = useState<VesselAttacksFeedShape | null>(null);
  const [selectedNewsDay, setSelectedNewsDay] = useState<string | null>(null);
  const [newsSourceFilter, setNewsSourceFilter] = useState<string>("all");
  const [selectedAttackIndex, setSelectedAttackIndex] = useState(0);
  const [selectedRedSeaCrossingTypes, setSelectedRedSeaCrossingTypes] = useState<RedSeaCrossingType[]>(RED_SEA_CROSSING_TYPES);
  const [selectedRedSeaVesselTypes, setSelectedRedSeaVesselTypes] = useState<RedSeaVesselType[]>(["tanker"]);
  const [redSeaWindow, setRedSeaWindow] = useState<"24h" | "48h" | "all">("24h");
  const [selectedRedSeaEventIds, setSelectedRedSeaEventIds] = useState<string[]>([]);
  const [redSeaSort, setRedSeaSort] = useState<{ key: "time" | "ship" | "vessel" | "crossing" | "lookback"; dir: "asc" | "desc" }>({ key: "time", dir: "desc" });
  const [newDataAvailable, setNewDataAvailable] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [mapMode, setMapMode] = useState<"confirmed" | "candidates">("confirmed");
  const candidateDefaultsAppliedRef = useRef(false);
  const crossingDefaultsAppliedRef = useRef(false);
  const redSeaDefaultsAppliedRef = useRef(false);
  const interactionAtRef = useRef<number>(Date.now());
  const mountedAtRef = useRef<number>(Date.now());
  const latestGeneratedAtRef = useRef<string | null>(null);
  const lastLiveRevalidateAtRef = useRef<number>(0);

  const root = process.env.NEXT_PUBLIC_HORMUZ_DATA_ROOT || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/multi_region";
  const remoteNewsUrl = process.env.NEXT_PUBLIC_HORMUZ_NEWS_URL || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/news_feed.json";
  const remoteAttacksUrl = process.env.NEXT_PUBLIC_HORMUZ_ATTACKS_URL || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/vessel_attacks_latest.json";
  const localNewsUrl = "/data/news_feed.json";
  const localAttacksUrl = "/data/vessel_attacks_latest.json";

  const fetchJson = useMemo(() => async (url: string, options?: { freshness?: FetchFreshness }) => {
    const freshness = options?.freshness || "revalidate";
    const shouldBustCache = freshness === "bust";
    const resolvedUrl = shouldBustCache ? `${url}${url.includes("?") ? "&" : "?"}_ts=${Date.now()}` : url;
    const cacheMode: RequestCache = freshness === "cache"
      ? "force-cache"
      : freshness === "bust"
        ? "no-store"
        : "no-cache";
    const r = await fetch(resolvedUrl, { cache: cacheMode });
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
  }, []);

  const loadNews = useMemo(() => async (freshness: FetchFreshness = "revalidate") => {
    try {
      const news = await fetchJson(remoteNewsUrl, { freshness });
      setNewsFeed(news as NewsFeedShape);
      return;
    } catch {
      // fall through to local artifact
    }
    try {
      const news = await fetchJson(localNewsUrl, { freshness });
      setNewsFeed(news as NewsFeedShape);
    } catch {
      setNewsFeed(null);
    }
  }, [fetchJson, localNewsUrl, remoteNewsUrl]);

  const loadAttacks = useMemo(() => async (freshness: FetchFreshness = "revalidate") => {
    try {
      const attacks = await fetchJson(remoteAttacksUrl, { freshness });
      setAttacksFeed(attacks as VesselAttacksFeedShape);
      return;
    } catch {
      // fall through to local artifact
    }
    try {
      const attacks = await fetchJson(localAttacksUrl, { freshness });
      setAttacksFeed(attacks as VesselAttacksFeedShape);
    } catch {
      setAttacksFeed(null);
    }
  }, [fetchJson, localAttacksUrl, remoteAttacksUrl]);

  const loadDashboardData = useMemo(() => async (freshness: FetchFreshness = "revalidate") => {
    const isLiveRevalidate = freshness !== "cache";
    if (isLiveRevalidate) lastLiveRevalidateAtRef.current = Date.now();
    await Promise.all([loadNews(freshness), loadAttacks(freshness)]);
    try {
      const core = await fetchJson(`${root}/processed_core.json`, { freshness });
      const paths = await fetchJson(`${root}/processed_paths.json`, { freshness });
      const candidates = await fetchJson(`${root}/processed_candidates.json`, { freshness });
      const latestPlayback = await fetchJson(`${root}/processed_playback_latest.json`, { freshness });
      const latestShipmeta = await fetchJson(`${root}/processed_shipmeta_latest.json`, { freshness });

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
        shipMeta: latestShipmeta?.data?.shipMeta || core?.data?.shipMeta || {},
        snapshots: Array.isArray(latestPlayback?.data?.snapshots) ? latestPlayback.data.snapshots : [],
        crossingsByHour: Array.isArray(core?.data?.crossingsByHour) ? core.data.crossingsByHour : [],
        crossingEvents: Array.isArray(core?.data?.crossingEvents) ? core.data.crossingEvents : [],
        crossingPaths: Array.isArray(paths?.data?.crossingPaths) ? paths.data.crossingPaths : [],
        redSeaCrossingsByDay: Array.isArray(core?.data?.redSeaCrossingsByDay) ? core.data.redSeaCrossingsByDay : [],
        redSeaCrossingEvents: Array.isArray(core?.data?.redSeaCrossingEvents) ? core.data.redSeaCrossingEvents : [],
        redSeaCrossingRoutes: Array.isArray(paths?.data?.redSeaCrossingRoutes) ? paths.data.redSeaCrossingRoutes : [],
        linkageEvents: Array.isArray(core?.data?.linkageEvents) ? core.data.linkageEvents : [],
        externalPresencePoints: Array.isArray(core?.data?.externalPresencePoints) ? core.data.externalPresencePoints : [],
        confirmedCrossingExclusions: Array.isArray(core?.data?.confirmedCrossingExclusions) ? core.data.confirmedCrossingExclusions : [],
      };

      setSplitMode(true);
      setData(normalized);
      setTankerCandidatesData(Array.isArray(candidates?.data?.tankerCandidates) ? candidates.data.tankerCandidates : []);
      setCargoCandidatesData(Array.isArray(candidates?.data?.cargoCandidates) ? candidates.data.cargoCandidates : []);
      setTankerCandidateEventsData(Array.isArray(candidates?.data?.tankerCandidateEvents) ? candidates.data.tankerCandidateEvents : []);
      setCargoCandidateEventsData(Array.isArray(candidates?.data?.cargoCandidateEvents) ? candidates.data.cargoCandidateEvents : []);
      setExternalPoints(Array.isArray(candidates?.data?.relevantExternalPoints) ? candidates.data.relevantExternalPoints : []);
      const defaults = normalized.vesselTypes.includes("tanker") ? ["tanker"] : normalized.vesselTypes;
      setSelectedTypes(defaults);
      setCrossingMapTypes(normalized.vesselTypes.includes("tanker") ? ["tanker"] : defaults);
      setPlaybackDataMode("latest");
      setFrameIndex(normalized.snapshots.length ? normalized.snapshots.length - 1 : 0);
      setNewDataAvailable(false);
      return;
    } catch (err) {
      console.error("Failed to load split dashboard artifacts", err);
    }
  }, [fetchJson, loadAttacks, loadNews, root]);

  useEffect(() => {
    void loadDashboardData("revalidate");
  }, [loadDashboardData]);

  useEffect(() => {
    if (!data?.metadata?.generatedAt) return;
    latestGeneratedAtRef.current = data.metadata.generatedAt;
  }, [data?.metadata?.generatedAt]);

  const handleRefreshData = async () => {
    setIsRefreshingData(true);
    try {
      await loadDashboardData("bust");
    } finally {
      setIsRefreshingData(false);
    }
  };

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
        const r = await fetch(`${root}/processed_core.json`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const remoteGen = j?.metadata?.generatedAt as string | undefined;
          const localGen = latestGeneratedAtRef.current;
          if (remoteGen && localGen && +new Date(remoteGen) > +new Date(localGen)) {
            setNewDataAvailable(true);
            if (isIdle()) void loadDashboardData("bust");
          }
        }
      } catch {
        // ignore polling errors
      }

      const elapsed = Date.now() - mountedAtRef.current;
      if (elapsed > 45 * 60 * 1000 && isIdle()) {
        void loadDashboardData("bust");
      }
    };

    const id = setInterval(checkForFreshData, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadDashboardData]);

  useEffect(() => {
    if (!newDataAvailable) return;
    const id = setInterval(() => {
      if (Date.now() - interactionAtRef.current > 120000) {
        void loadDashboardData("bust");
      }
    }, 30000);
    return () => clearInterval(id);
  }, [newDataAvailable, loadDashboardData]);

  useEffect(() => {
    const maybeRevalidateVisibleData = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastLiveRevalidateAtRef.current < 60000) return;
      void loadDashboardData("revalidate");
    };

    const onPageShow = () => {
      void maybeRevalidateVisibleData();
    };

    document.addEventListener("visibilitychange", maybeRevalidateVisibleData);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", maybeRevalidateVisibleData);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    if (!playing || !data?.snapshots?.length) return;
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % data.snapshots.length);
    }, 650);
    return () => clearInterval(id);
  }, [playing, data?.snapshots?.length]);

  useEffect(() => {
    if (!splitMode || !data || playbackDataMode === "latest") return;
    const root = process.env.NEXT_PUBLIC_HORMUZ_DATA_ROOT || "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/multi_region";

    const fetchJsonMaybeGzip = async (url: string) => {
      const r = await fetch(url, { cache: "force-cache" });
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
        const playbackJson = await fetchJsonMaybeGzip(`${root}/processed_playback_${playbackDataMode}.json`);
        const shipmetaJson = await fetchJsonMaybeGzip(`${root}/processed_shipmeta_${playbackDataMode}.json`);
        const externalJson = loadAllRegions ? await fetchJsonMaybeGzip(`${root}/processed_external_${playbackDataMode}.json`) : null;
        const snaps = Array.isArray(playbackJson?.data?.snapshots) ? playbackJson.data.snapshots : [];
        const ext = Array.isArray(externalJson?.data?.externalPresencePoints) ? externalJson.data.externalPresencePoints : [];
        const sm = shipmetaJson?.data?.shipMeta || {};
        setData((prev) => (prev ? { ...prev, snapshots: snaps, shipMeta: sm } : prev));
        setExternalPoints(ext);
        setFrameIndex(snaps.length ? snaps.length - 1 : 0);
      } finally {
        setPlaybackLoading(false);
      }
    };

    fetchWindowData();
  }, [splitMode, loadAllRegions, playbackDataMode]);

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
  const latestCandidateSnapshotTs = useMemo(
    () => (data?.snapshots?.length ? +new Date(data.snapshots[data.snapshots.length - 1].t) : +new Date(data?.metadata?.generatedAt || 0)),
    [data?.snapshots, data?.metadata?.generatedAt],
  );

  const candidateShipIds = useMemo(() => new Set(candidateCrossers.map((c) => c.shipId)), [candidateCrossers]);
  const highConfidenceCandidates = useMemo(
    () => candidateCrossers.filter((c) => c.confidenceBand === "high"),
    [candidateCrossers],
  );
  const highConfidenceCandidateEvents = useMemo(
    () => tankerCandidateEventsData.filter((c) => c.confidenceBand === "high"),
    [tankerCandidateEventsData],
  );
  const suspectedCandidateSpoofingKeys = useMemo(
    () => buildSuspectedOppositeDirectionKeySet(highConfidenceCandidateEvents),
    [highConfidenceCandidateEvents],
  );
  const isSuspectedCandidateSpoofingEvent = (e: CandidateEvent) => suspectedCandidateSpoofingKeys.has(`${e.shipId}|${e.lastSeenAt}|${e.inferredDirection}`);
  const highConfidenceCandidateEventsForCharts = useMemo(
    () => highConfidenceCandidateEvents.filter((e) => !discardSuspectedSpoofing || !isSuspectedCandidateSpoofingEvent(e)),
    [highConfidenceCandidateEvents, discardSuspectedSpoofing, suspectedCandidateSpoofingKeys],
  );
  const newsDays = useMemo(() => {
    const byDay = new Map<string, { day: string; headline: string; items: NewsItem[] }>();
    for (const item of newsFeed?.items || []) {
      const d = new Date(item.publishedAt);
      d.setUTCHours(0, 0, 0, 0);
      const day = d.toISOString();
      if (!byDay.has(day)) byDay.set(day, { day, headline: item.title, items: [] });
      byDay.get(day)!.items.push(item);
    }
    return [...byDay.values()]
      .map((entry) => ({
        ...entry,
        items: [...entry.items].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
      }))
      .sort((a, b) => +new Date(b.day) - +new Date(a.day));
  }, [newsFeed]);
  const selectedNewsDayEntry = useMemo(() => {
    if (!newsDays.length) return null;
    if (!selectedNewsDay) return newsDays[0];
    return newsDays.find((d) => d.day === selectedNewsDay) || newsDays[0];
  }, [newsDays, selectedNewsDay]);
  const newsSourceOptions = useMemo(() => {
    const labels = [...new Set((newsFeed?.items || []).map((item) => deriveNewsDisplaySource(item)).filter(Boolean))];
    return labels.sort((a, b) => a.localeCompare(b));
  }, [newsFeed]);
  const filteredNewsItems = useMemo(() => {
    const items = newsFeed?.items || [];
    if (newsSourceFilter === "all") return items;
    return items.filter((item) => deriveNewsDisplaySource(item) === newsSourceFilter);
  }, [newsFeed, newsSourceFilter]);

  const vesselAttackItems = useMemo(() => {
    const items = Array.isArray(attacksFeed?.items) ? attacksFeed.items : [];
    return [...items].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [attacksFeed]);

  useEffect(() => {
    if (!vesselAttackItems.length) {
      setSelectedAttackIndex(0);
      return;
    }
    setSelectedAttackIndex(vesselAttackItems.length - 1);
  }, [vesselAttackItems]);

  const selectedAttack = vesselAttackItems[selectedAttackIndex] || vesselAttackItems[vesselAttackItems.length - 1] || null;
  const vesselAttacksSummary = attacksFeed?.vesselAttacks24hSummary || null;
  const candidateDailyHigh = useMemo(
    () => aggregateCandidatesToDailyBins(highConfidenceCandidateEventsForCharts),
    [highConfidenceCandidateEventsForCharts],
  );
  const candidateChartTicks = useMemo(() => candidateDailyHigh.map((x) => x.hour), [candidateDailyHigh]);
  const latestCandidateEventTs = useMemo(
    () => tankerCandidateEventsData.length ? Math.max(...tankerCandidateEventsData.map((c) => +new Date(c.lastSeenAt))) : null,
    [tankerCandidateEventsData],
  );
  const candidateReferenceTs = latestCandidateSnapshotTs || latestCandidateEventTs;
  const candidate24hCutoffTs = useMemo(
    () => candidateReferenceTs == null ? null : candidateReferenceTs - 24 * 60 * 60 * 1000,
    [candidateReferenceTs],
  );
  const candidateLast24hHighCount = useMemo(
    () => candidate24hCutoffTs == null || candidateReferenceTs == null ? 0 : highConfidenceCandidateEventsForCharts.filter((c) => {
      const ts = +new Date(c.lastSeenAt);
      return ts >= candidate24hCutoffTs && ts <= candidateReferenceTs;
    }).length,
    [highConfidenceCandidateEventsForCharts, candidate24hCutoffTs, candidateReferenceTs],
  );
  const candidateLast24hLowCount = useMemo(
    () => candidate24hCutoffTs == null || candidateReferenceTs == null ? 0 : tankerCandidateEventsData.filter((c) => {
      if (c.confidenceBand !== "low") return false;
      if (discardSuspectedSpoofing && suspectedCandidateSpoofingKeys.has(`${c.shipId}|${c.lastSeenAt}|${c.inferredDirection}`)) return false;
      const ts = +new Date(c.lastSeenAt);
      return ts >= candidate24hCutoffTs && ts <= candidateReferenceTs;
    }).length,
    [tankerCandidateEventsData, discardSuspectedSpoofing, suspectedCandidateSpoofingKeys, candidate24hCutoffTs, candidateReferenceTs],
  );
  const selectedCrossingShipIdSet = useMemo(() => new Set(selectedCrossingShipIds), [selectedCrossingShipIds]);
  const selectedCandidateShipIdSet = useMemo(() => new Set(selectedCandidateShipIds), [selectedCandidateShipIds]);
  const redSeaCrossingEvents = useMemo(
    () => Array.isArray(data?.redSeaCrossingEvents)
      ? data.redSeaCrossingEvents.filter((event) => RED_SEA_VESSEL_TYPES.includes(event.vesselType as RedSeaVesselType))
      : [],
    [data?.redSeaCrossingEvents],
  );
  const redSeaCrossingRoutes = useMemo(
    () => Array.isArray(data?.redSeaCrossingRoutes)
      ? data.redSeaCrossingRoutes.filter((route) => RED_SEA_VESSEL_TYPES.includes(route.vesselType as RedSeaVesselType))
      : [],
    [data?.redSeaCrossingRoutes],
  );
  const selectedRedSeaTypeSet = useMemo(() => new Set(selectedRedSeaCrossingTypes), [selectedRedSeaCrossingTypes]);
  const selectedRedSeaVesselTypeSet = useMemo(() => new Set(selectedRedSeaVesselTypes), [selectedRedSeaVesselTypes]);
  const selectedRedSeaEventIdSet = useMemo(() => new Set(selectedRedSeaEventIds), [selectedRedSeaEventIds]);
  const redSeaEventsForFilters = useMemo(
    () => redSeaCrossingEvents.filter(
      (event) => selectedRedSeaTypeSet.has(event.crossingType) && selectedRedSeaVesselTypeSet.has(event.vesselType as RedSeaVesselType),
    ),
    [redSeaCrossingEvents, selectedRedSeaTypeSet, selectedRedSeaVesselTypeSet],
  );
  const redSeaLatestTs = useMemo(
    () => redSeaEventsForFilters.length ? Math.max(...redSeaEventsForFilters.map((event) => +new Date(event.crossingTime || event.t))) : null,
    [redSeaEventsForFilters],
  );
  const redSeaWindowHours = redSeaWindow === "all" ? null : Number.parseInt(redSeaWindow, 10);
  const filteredRedSeaCrossingEvents = useMemo(() => {
    if (redSeaLatestTs == null) return [] as RedSeaCrossingEvent[];
    const cutoff = redSeaWindowHours == null ? null : redSeaLatestTs - redSeaWindowHours * 60 * 60 * 1000;
    return redSeaEventsForFilters.filter((event) => {
      if (cutoff == null) return true;
      const ts = +new Date(event.crossingTime || event.t);
      return ts >= cutoff && ts <= redSeaLatestTs;
    });
  }, [redSeaEventsForFilters, redSeaLatestTs, redSeaWindowHours]);
  const filteredRedSeaCrossingRoutes = useMemo(() => {
    const visibleEventIds = new Set(filteredRedSeaCrossingEvents.map((event) => event.eventId));
    return redSeaCrossingRoutes.filter((route) => visibleEventIds.has(route.eventId));
  }, [redSeaCrossingRoutes, filteredRedSeaCrossingEvents]);
  const filteredRedSeaCrossingsByDay = useMemo(
    () => aggregateRedSeaEventsToDailyBins(redSeaEventsForFilters),
    [redSeaEventsForFilters],
  );
  const redSeaVisibleCounts = useMemo(() => {
    const counts = {
      south_outbound: 0,
      south_inbound: 0,
      north_outbound: 0,
      north_inbound: 0,
    } as Record<RedSeaCrossingType, number>;
    for (const event of filteredRedSeaCrossingEvents) {
      counts[event.crossingType] += 1;
    }
    return counts;
  }, [filteredRedSeaCrossingEvents]);
  const redSeaSummary = useMemo(() => {
    const uniqueShipIds = new Set(filteredRedSeaCrossingEvents.map((event) => event.shipId));
    return {
      crossings: filteredRedSeaCrossingEvents.length,
      ships: uniqueShipIds.size,
    };
  }, [filteredRedSeaCrossingEvents]);
  const redSeaWindowLabel = redSeaWindow === "all" ? "All visible" : `Last ${redSeaWindow}`;
  const redSeaMatrixVesselLabel = useMemo(() => {
    const hasTanker = selectedRedSeaVesselTypeSet.has("tanker");
    const hasCargo = selectedRedSeaVesselTypeSet.has("cargo");
    if (hasTanker && hasCargo) return "all vessels";
    if (hasTanker) return "Tankers";
    if (hasCargo) return "Cargos";
    return "No vessels selected";
  }, [selectedRedSeaVesselTypeSet]);
  const redSeaToplineMetrics = useMemo(() => {
    const endTs = data?.metadata?.generatedAt
      ? +new Date(data.metadata.generatedAt)
      : data?.snapshots?.length
        ? +new Date(data.snapshots[data.snapshots.length - 1].t)
        : Date.now();
    const last24hCutoffTs = endTs - 24 * 60 * 60 * 1000;
    const last7dCutoffTs = endTs - 7 * 24 * 60 * 60 * 1000;
    const stats = Object.fromEntries(
      RED_SEA_CROSSING_TYPES.map((crossingType) => [crossingType, { last24h: 0, last7dTotal: 0 }]),
    ) as Record<RedSeaCrossingType, { last24h: number; last7dTotal: number }>;

    for (const event of redSeaCrossingEvents) {
      if (event.vesselType !== "tanker") continue;
      const ts = +new Date(event.crossingTime || event.t);
      if (ts > endTs) continue;
      if (ts >= last24hCutoffTs) stats[event.crossingType].last24h += 1;
      if (ts >= last7dCutoffTs) stats[event.crossingType].last7dTotal += 1;
    }

    return Object.fromEntries(
      RED_SEA_CROSSING_TYPES.map((crossingType) => [
        crossingType,
        {
          last24h: stats[crossingType].last24h,
          last7dAvg: stats[crossingType].last7dTotal / 7,
        },
      ]),
    ) as Record<RedSeaCrossingType, { last24h: number; last7dAvg: number }>;
  }, [redSeaCrossingEvents, data?.metadata?.generatedAt, data?.snapshots]);
  const redSeaEventRows = useMemo(() => {
    const rows = [...filteredRedSeaCrossingEvents];
    rows.sort((a, b) => {
      const dir = redSeaSort.dir === "asc" ? 1 : -1;
      if (redSeaSort.key === "ship") return a.shipName.localeCompare(b.shipName) * dir;
      if (redSeaSort.key === "vessel") return a.vesselType.localeCompare(b.vesselType) * dir;
      if (redSeaSort.key === "crossing") return a.crossingType.localeCompare(b.crossingType) * dir;
      if (redSeaSort.key === "lookback") return ((a.lookbackHours || 0) - (b.lookbackHours || 0)) * dir;
      return ((+new Date(a.crossingTime || a.t)) - (+new Date(b.crossingTime || b.t))) * dir;
    });
    return rows;
  }, [filteredRedSeaCrossingEvents, redSeaSort]);

  useEffect(() => {
    const valid = new Set(candidateCrossers.map((c) => c.shipId));
    const highIds = candidateCrossersForDisplay
      .filter((c) => c.confidenceBand === "high")
      .map((c) => c.shipId);

    if (!candidateDefaultsAppliedRef.current) {
      setSelectedCandidateShipIds(highIds);
      candidateDefaultsAppliedRef.current = true;
      return;
    }

    setSelectedCandidateShipIds((prev) => {
      const stillValid = prev.filter((id) => valid.has(id));
      if (stillValid.length === 0 && highIds.length) return highIds;
      return stillValid;
    });
  }, [candidateCrossersForDisplay, candidateCrossers]);

  useEffect(() => {
    const validEventIds = new Set(filteredRedSeaCrossingEvents.map((event) => event.eventId));
    const last24Cutoff = redSeaLatestTs == null ? null : redSeaLatestTs - 24 * 60 * 60 * 1000;
    const last24EventIds = last24Cutoff == null || redSeaLatestTs == null
      ? []
      : redSeaEventsForFilters
        .filter((event) => {
          const ts = +new Date(event.crossingTime || event.t);
          return ts >= last24Cutoff && ts <= redSeaLatestTs;
        })
        .map((event) => event.eventId)
        .filter((eventId) => validEventIds.has(eventId));

    if (!redSeaDefaultsAppliedRef.current) {
      setSelectedRedSeaEventIds(last24EventIds);
      redSeaDefaultsAppliedRef.current = true;
      return;
    }

    setSelectedRedSeaEventIds((prev) => {
      const stillValid = prev.filter((eventId) => validEventIds.has(eventId));
      if (stillValid.length === 0 && last24EventIds.length) return last24EventIds;
      return stillValid;
    });
  }, [filteredRedSeaCrossingEvents, redSeaEventsForFilters, redSeaLatestTs]);

  const suspectedSpoofingEventKeys = useMemo(
    () => buildSuspectedSpoofingEventKeySet(data?.crossingEvents || []),
    [data?.crossingEvents],
  );

  const isSuspectedSpoofingEvent = (e: CrossingEvent) => suspectedSpoofingEventKeys.has(`${e.shipId}|${e.t}|${e.direction}`);
  const isManuallyExcludedCrossingEvent = (e: CrossingEvent) => Boolean(e.manuallyExcluded);
  const isExcludedCrossingEvent = (e: CrossingEvent) => isManuallyExcludedCrossingEvent(e) || isSuspectedSpoofingEvent(e);

  const crossingEventsForCharts = useMemo(
    () => (data?.crossingEvents || []).filter((e) => !discardSuspectedSpoofing || !isExcludedCrossingEvent(e)),
    [data?.crossingEvents, discardSuspectedSpoofing, suspectedSpoofingEventKeys],
  );

  const hourlyFromEvents = (vesselType: string) => {
    if (!crossingEventsForCharts.length) return [] as CrossingHour[];
    const byHour = new Map<string, { hour: string; east_to_west: number; west_to_east: number }>();
    for (const e of crossingEventsForCharts) {
      if (e.vesselType !== vesselType) continue;
      if (!byHour.has(e.hour)) byHour.set(e.hour, { hour: e.hour, east_to_west: 0, west_to_east: 0 });
      if (e.direction === "east_to_west") byHour.get(e.hour)!.east_to_west += 1;
      if (e.direction === "west_to_east") byHour.get(e.hour)!.west_to_east += 1;
    }
    return [...byHour.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
  };

  const tankerHourly = useMemo(() => hourlyFromEvents("tanker"), [crossingEventsForCharts]);
  const cargoHourly = useMemo(() => hourlyFromEvents("cargo"), [crossingEventsForCharts]);

  const sharedHours = useMemo(() => {
    const eventHours = crossingEventsForCharts
      .map((e) => e.hour)
      .sort((a, b) => +new Date(a) - +new Date(b));
    if (!eventHours.length) return [] as string[];
    const start = toHourStartIso(eventHours[0]);
    const end = toHourStartIso(eventHours[eventHours.length - 1]);
    return buildContinuousHourRange(start, end);
  }, [crossingEventsForCharts]);

  const tankerHourlyAligned = useMemo(() => alignHours(tankerHourly, sharedHours), [tankerHourly, sharedHours]);
  const cargoHourlyAligned = useMemo(() => alignHours(cargoHourly, sharedHours), [cargoHourly, sharedHours]);
  const tankerDaily = useMemo(() => aggregateToDailyBins(tankerHourlyAligned), [tankerHourlyAligned]);
  const cargoDaily = useMemo(() => aggregateToDailyBins(cargoHourlyAligned), [cargoHourlyAligned]);
  const chartTicks = useMemo(() => tankerDaily.map((x) => x.hour), [tankerDaily]);

  const tankerNamesAtSelectedHour = useMemo(() => {
    if (!data || !selectedTankerHour) return [] as { shipName: string; shipId: string; direction: string; t: string }[];
    return crossingEventsForCharts
      .filter((e) => e.vesselType === "tanker" && isSameUtcDay(e.t, selectedTankerHour))
      .map((e) => ({ shipName: e.shipName, shipId: e.shipId, direction: e.direction, t: e.t }))
      .sort((a, b) => +new Date(a.t) - +new Date(b.t));
  }, [crossingEventsForCharts, data, selectedTankerHour]);

  const cargoNamesAtSelectedHour = useMemo(() => {
    if (!data || !selectedCargoHour) return [] as { shipName: string; shipId: string; direction: string; t: string }[];
    return crossingEventsForCharts
      .filter((e) => e.vesselType === "cargo" && isSameUtcDay(e.t, selectedCargoHour))
      .map((e) => ({ shipName: e.shipName, shipId: e.shipId, direction: e.direction, t: e.t }))
      .sort((a, b) => +new Date(a.t) - +new Date(b.t));
  }, [crossingEventsForCharts, data, selectedCargoHour]);

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
    const filtered = selectedTankerHour ? rows.filter((e) => isSameUtcDay(e.t, selectedTankerHour)) : rows;
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
    const filtered = selectedCargoHour ? rows.filter((e) => isSameUtcDay(e.t, selectedCargoHour)) : rows;
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

  const last24hCrossingCounts = useMemo(() => {
    if (!crossingEventsForCharts.length || !data) return { tanker: 0, cargo: 0, other: 0 };

    const latestTs = data.snapshots?.length
      ? +new Date(data.snapshots[data.snapshots.length - 1].t)
      : +new Date(data.metadata.generatedAt);
    const cutoff = latestTs - 24 * 60 * 60 * 1000;

    const tankerIds = new Set<string>();
    const cargoIds = new Set<string>();
    const otherIds = new Set<string>();

    for (const e of crossingEventsForCharts) {
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
  }, [crossingEventsForCharts, data]);

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
        if (isExcludedCrossingEvent(e)) return false;
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
  }, [data, crossingMapTypes, crossingDirectionFilter, suspectedSpoofingEventKeys]);

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

  const externalLinkRows = useMemo(
    () => linkageRows.filter((r) => EXTERNAL_REGIONS.includes(r.otherRegion as (typeof EXTERNAL_REGIONS)[number])),
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
  const crossingMapPaths = useMemo(() => filteredCrossingPathsForMap.slice(0, 180), [filteredCrossingPathsForMap]);
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
    const rows = hideSpoofingDetectedCrossings
      ? filteredCrossingEvents.filter((event) => !isExcludedCrossingEvent(event))
      : filteredCrossingEvents;

    return [...rows].sort((a, b) => {
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
  }, [filteredCrossingEvents, crossingDetailSort, transitTimeByShip, hideSpoofingDetectedCrossings]);

  const candidateTableRows = useMemo(() => {
    const rank = { high: 2, low: 1, no: 0 } as const;
    const rows = tankerCandidateEventsData.filter((c) => !discardSuspectedSpoofing || !isSuspectedCandidateSpoofingEvent(c));
    return [...rows].sort((a, b) => {
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
  }, [tankerCandidateEventsData, discardSuspectedSpoofing, suspectedCandidateSpoofingKeys, candidateSort]);
  const toggleSelectedCrossingShip = useCallback((shipId: string) => {
    startTransition(() => {
      setSelectedCrossingShipIds((prev) => (
        prev.includes(shipId) ? prev.filter((id) => id !== shipId) : [...prev, shipId]
      ));
    });
  }, []);
  const onlySelectedCrossingShip = useCallback((shipId: string) => {
    startTransition(() => {
      setSelectedCrossingShipIds([shipId]);
    });
  }, []);
  const resetSelectedCrossingShips = useCallback(() => {
    startTransition(() => {
      setSelectedCrossingShipIds([]);
    });
  }, []);
  const toggleSelectedRedSeaEvent = useCallback((eventId: string) => {
    startTransition(() => {
      setSelectedRedSeaEventIds((prev) => (
        prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
      ));
    });
  }, []);
  const onlySelectedRedSeaEvent = useCallback((eventId: string) => {
    startTransition(() => {
      setSelectedRedSeaEventIds([eventId]);
    });
  }, []);
  const resetSelectedRedSeaEvents = useCallback(() => {
    startTransition(() => {
      setSelectedRedSeaEventIds([]);
    });
  }, []);

  const externalFrameRegionPick = useMemo(() => {
    if (!externalPoints?.length || !data?.snapshots?.length) {
      return new Map<string, ExternalPresencePoint[]>();
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

    return new Map([...frameRegionPick.entries()].map(([key, value]) => [key, value.points]));
  }, [data?.snapshots, externalPoints, showOnlyLinkedExternal]);

  const playbackLinkedPoints = useMemo(() => {
    if (!currentSnapshot?.t || !externalFrameRegionPick.size) {
      return [] as { shipId: string; shipName: string; vesselType: string; region: string; lat: number; lon: number; deltaDh: string }[];
    }
    const out: { shipId: string; shipName: string; vesselType: string; region: string; lat: number; lon: number; deltaDh: string }[] = [];
    for (const region of EXTERNAL_REGIONS) {
      const pick = externalFrameRegionPick.get(`${currentSnapshot.t}|${region}`);
      if (!pick) continue;
      for (const p of pick) {
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
  }, [currentSnapshot?.t, externalFrameRegionPick, selectedTypes]);

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
          red_sea: null,
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
      red_sea: null,
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

    const rows = [...confirmedRows, ...candidateRows].sort((a, b) => {
      const typeCmp = String(a.ship_type).localeCompare(String(b.ship_type));
      if (typeCmp !== 0) return typeCmp;
      const recordCmp = String(a.record_type).localeCompare(String(b.record_type));
      if (recordCmp !== 0) return recordCmp;
      return +new Date(String(b.sort_date_utc)) - +new Date(String(a.sort_date_utc));
    });

    const generatedAtCompact = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(
      `hormuz-crossings-and-high-confidence-candidates-${generatedAtCompact}.csv`,
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
                onClick={() => { void handleRefreshData(); }}
                className="rounded-md border border-cyan-300/60 px-2 py-1"
                disabled={isRefreshingData}
              >
                {isRefreshingData ? "Refreshing..." : "Refresh now"}
              </button>
            </div>
          ) : null}
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Strait of Hormuz Traffic Intelligence</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
              Data updated: {data?.metadata?.generatedAt ? new Date(data.metadata.generatedAt).toUTCString() : "unknown"}
            </div>
            <button
              onClick={() => { void handleRefreshData(); }}
              disabled={isRefreshingData}
              className="inline-flex items-center rounded-xl border border-cyan-200/90 bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-[0_0_0_1px_rgba(165,243,252,0.45),0_12px_28px_rgba(34,211,238,0.35)] transition hover:bg-cyan-300 disabled:opacity-60 disabled:hover:bg-cyan-400"
            >
              {isRefreshingData ? "Refreshing data..." : "Refresh data"}
            </button>
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
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm xl:grid-cols-4 md:grid-cols-2">
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
              <div className="mt-1 text-[10px] leading-relaxed text-amber-100/80">
                Window anchored to latest dashboard snapshot, not the latest candidate event.
              </div>
              <button
                onClick={() => document.getElementById("candidate-dark-crossers")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-amber-300/60 px-2 py-1 text-[11px] text-amber-100"
              >
                Jump to candidate section
              </button>
            </div>
            {RED_SEA_TOPLINE_GROUPS.map((group) => (
              <div key={group.key} className={`rounded-xl border p-3 ${group.backgroundClass}`}>
                <div className={`text-xs ${group.accentClass}`}>{group.title}</div>
                <div className="mt-3 space-y-2">
                  {group.items.map(({ crossingType, label }) => (
                    <div key={`${group.key}-${crossingType}`} className="flex items-baseline justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-300">{label}</div>
                      <div className="text-right">
                        <span className="text-lg font-semibold text-slate-100">{redSeaToplineMetrics[crossingType].last24h}</span>
                        <span className="ml-1 text-[10px] text-slate-300/80">
                          ({redSeaToplineMetrics[crossingType].last7dAvg.toFixed(1)}/d 7d avg)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => document.getElementById("red-sea-crossings")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className={`mt-3 rounded-md border px-2 py-1 text-[11px] ${group.buttonClass}`}
                >
                  Jump to Red Sea section
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded-xl border border-fuchsia-300/60 bg-fuchsia-500/10 p-3">
              <div className="text-xs text-fuchsia-200">News — last update</div>
              <div className="mt-1 text-sm font-semibold leading-snug text-fuchsia-100">{newsFeed?.lastUpdateSummary?.headline || "No latest news summary yet"}</div>
              <button
                onClick={() => document.getElementById("newsfeed")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-fuchsia-300/60 px-2 py-1 text-[11px] text-fuchsia-100"
              >
                Jump to news section
              </button>
            </div>
            <div className="rounded-xl border border-purple-300/60 bg-purple-500/10 p-3">
              <div className="text-xs text-purple-200">News — last 24h</div>
              <div className="mt-1 text-sm font-semibold leading-snug text-purple-100">{newsFeed?.last24hSummary?.headline || "No 24h news summary yet"}</div>
              <button
                onClick={() => document.getElementById("newsfeed")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-purple-300/60 px-2 py-1 text-[11px] text-purple-100"
              >
                Jump to news section
              </button>
            </div>
            <div className="rounded-xl border border-rose-300/60 bg-rose-500/10 p-3">
              <div className="text-xs text-rose-200">Vessel attacks — last 24h</div>
              <div className="mt-1 text-sm font-semibold leading-snug text-rose-100">{vesselAttacksSummary?.headline || "No 24h attack summary yet"}</div>
              <button
                onClick={() => document.getElementById("vessel-attacks")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="mt-2 rounded-md border border-rose-300/60 px-2 py-1 text-[11px] text-rose-100"
              >
                Jump to attacks section
              </button>
            </div>
          </div>
          <section id="vessel-attacks" className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-rose-300">Attacks timeline</div>
                <div className="mt-1 text-sm text-slate-400">Left-to-right attack chronology. Click a circle to inspect the details for that day.</div>
              </div>
              <div className="text-xs text-slate-500">{vesselAttackItems.length} day{vesselAttackItems.length === 1 ? "" : "s"} loaded</div>
            </div>
            {vesselAttackItems.length ? (
              <div className="mt-4">
                <div className="relative overflow-x-auto pb-2">
                  <div className="relative min-w-[680px] px-4 py-8">
                    <div className="absolute left-4 right-10 top-1/2 h-[2px] -translate-y-1/2 bg-slate-600" />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">→</div>
                    <div className="relative flex items-center justify-between gap-6">
                      {vesselAttackItems.map((attack, idx) => {
                        const isSelected = idx === selectedAttackIndex;
                        const isSuspicious = attack.kind === "suspicious";
                        const dotClass = isSuspicious
                          ? (isSelected
                              ? "border-amber-200 bg-amber-400 shadow-[0_0_0_6px_rgba(251,191,36,0.18)]"
                              : "border-amber-300/80 bg-amber-500/80 group-hover:border-amber-200 group-hover:bg-amber-400")
                          : (isSelected
                              ? "border-rose-200 bg-rose-500 shadow-[0_0_0_6px_rgba(244,63,94,0.18)]"
                              : "border-slate-300 bg-slate-700 group-hover:border-rose-300 group-hover:bg-rose-400");
                        const dateClass = isSuspicious
                          ? (isSelected ? "text-amber-200" : "text-slate-400 group-hover:text-amber-100")
                          : (isSelected ? "text-rose-200" : "text-slate-400 group-hover:text-slate-200");
                        return (
                          <button
                            key={`${attack.date}-${attack.place}-${idx}`}
                            type="button"
                            onClick={() => setSelectedAttackIndex(idx)}
                            className="group relative flex flex-col items-center text-center"
                          >
                            <span className={`h-6 w-6 rounded-full border-4 ${dotClass}`} />
                            <span className={`mt-3 max-w-[120px] text-[11px] leading-4 ${dateClass}`}>
                              {new Date(attack.date).toUTCString().slice(5, 16)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {selectedAttack ? (
                  <div className={`mt-4 rounded-xl p-4 ${selectedAttack.kind === "suspicious" ? "border border-amber-900/40 bg-amber-950/20" : "border border-rose-900/40 bg-rose-950/20"}`}>
                    <div className={`text-xs uppercase tracking-[0.2em] ${selectedAttack.kind === "suspicious" ? "text-amber-300" : "text-rose-300"}`}>
                      {selectedAttack.kind === "suspicious" ? "Suspicious activity details" : "Attack details"}
                    </div>
                    {selectedAttack.statusLabel ? (
                      <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${selectedAttack.kind === "suspicious" ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-rose-400/40 bg-rose-400/10 text-rose-200"}`}>
                        {selectedAttack.statusLabel}
                      </div>
                    ) : null}
                    <div className="mt-2 text-lg font-semibold text-slate-100">{selectedAttack.place}</div>
                    <div className="mt-1 text-sm text-slate-400">{new Date(selectedAttack.date).toUTCString()}</div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{selectedAttack.summary}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-4 text-sm text-slate-400">
                No structured attack days yet. Once the collector writes the attack JSON, the timeline will appear here.
              </div>
            )}
          </section>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={downloadCrossingsCsv}
              className="inline-flex items-center rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100"
              title="Download CSV of confirmed crossings and high-confidence likely dark crossings"
            >
              Download CSV — crossings + likely crossings
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
                      onClick={() => {
                        setPlaybackWindow(w);
                        if (playbackDataMode !== "latest") setPlaybackDataMode(w);
                      }}
                      className={`rounded-md border px-2 py-1 ${playbackWindow === w ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                onClick={() => {
                  if (!playing && playbackDataMode === "latest") {
                    setPlaybackDataMode(playbackWindow);
                  }
                  setPlaying((v) => !v);
                }}
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
            <button onClick={() => setDiscardSuspectedSpoofing((v) => !v)} className={`px-2 py-1 rounded border ${discardSuspectedSpoofing ? "border-rose-300 text-rose-200" : "border-slate-700 text-slate-500"}`}>Discard suspected spoofing in charts: {discardSuspectedSpoofing ? "on" : "off"}</button>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-lg font-medium mb-3">Crossings in daily bins — Tanker</h2>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tankerDaily}
                  onClick={(state: any) => {
                    if (state?.activeLabel) setSelectedTankerHour(state.activeLabel as string);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="hour"
                    ticks={chartTicks}
                    tickFormatter={(v) => formatDayTick(v as string)}
                    minTickGap={40}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    content={(props) => (
                      <DailyCrossingsTooltip
                        active={props.active}
                        label={props.label as string | undefined}
                        payload={props.payload as ReadonlyArray<{ value?: number; name?: string; color?: string }> | undefined}
                        rows={data?.crossingEvents
                          ?.filter((e) => e.vesselType === "tanker" && props.label && isSameUtcDay(e.t, props.label as string))
                          .map((e) => ({ shipName: e.shipName, shipId: e.shipId, direction: e.direction, t: e.t }))
                          .sort((a, b) => +new Date(a.t) - +new Date(b.t)) || []}
                        shipMeta={data?.shipMeta}
                      />
                    )}
                  />
                  <Legend />
                  {showWestToEast ? <Bar stackId="direction" dataKey="west_to_east" fill="#f97316" name="West → East" /> : null}
                  {showEastToWest ? <Bar stackId="direction" dataKey="east_to_west" fill="#38bdf8" name="East → West" /> : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 text-xs text-slate-300">
              <div className="font-medium text-slate-200">
                {selectedTankerHour ? `Clicked day: ${new Date(selectedTankerHour).toUTCString()}` : "Click a tanker bar to list that day's crossings"}
              </div>
              {selectedTankerHour ? (
                tankerNamesAtSelectedHour.length ? (
                  <ul className="mt-2 space-y-1">
                    {tankerNamesAtSelectedHour.map((r, idx) => (
                      <li key={`${r.shipId}-${r.t}-${idx}`}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a> — {formatUtcTime(r.t)} — {r.direction.replace("_to_", " → ")}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-slate-400">No tanker crossings that day.</div>
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
                  {tankerTableRows.filter((r) => !isExcludedCrossingEvent(r)).map((r, idx) => {
                    const selected = selectedCrossingShipIdSet.has(r.shipId);
                    return (
                    <tr
                      key={`${r.shipId}-${r.t}-${idx}`}
                      className={`border-t border-slate-800 cursor-pointer ${selected ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}
                      onClick={() => toggleSelectedCrossingShip(r.shipId)}
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
            <h2 className="text-lg font-medium mb-3">Crossings in daily bins — Cargo</h2>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={cargoDaily}
                  onClick={(state: any) => {
                    if (state?.activeLabel) setSelectedCargoHour(state.activeLabel as string);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="hour"
                    ticks={chartTicks}
                    tickFormatter={(v) => formatDayTick(v as string)}
                    minTickGap={40}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    content={(props) => (
                      <DailyCrossingsTooltip
                        active={props.active}
                        label={props.label as string | undefined}
                        payload={props.payload as ReadonlyArray<{ value?: number; name?: string; color?: string }> | undefined}
                        rows={data?.crossingEvents
                          ?.filter((e) => e.vesselType === "cargo" && props.label && isSameUtcDay(e.t, props.label as string))
                          .map((e) => ({ shipName: e.shipName, shipId: e.shipId, direction: e.direction, t: e.t }))
                          .sort((a, b) => +new Date(a.t) - +new Date(b.t)) || []}
                        shipMeta={data?.shipMeta}
                      />
                    )}
                  />
                  <Legend />
                  {showWestToEast ? <Bar stackId="direction" dataKey="west_to_east" fill="#f97316" name="West → East" /> : null}
                  {showEastToWest ? <Bar stackId="direction" dataKey="east_to_west" fill="#38bdf8" name="East → West" /> : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 text-xs text-slate-300">
              <div className="font-medium text-slate-200">
                {selectedCargoHour ? `Clicked day: ${new Date(selectedCargoHour).toUTCString()}` : "Click a cargo bar to list that day's crossings"}
              </div>
              {selectedCargoHour ? (
                cargoNamesAtSelectedHour.length ? (
                  <ul className="mt-2 space-y-1">
                    {cargoNamesAtSelectedHour.map((r, idx) => (
                      <li key={`${r.shipId}-${r.t}-${idx}`}><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a> — {formatUtcTime(r.t)} — {r.direction.replace("_to_", " → ")}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-slate-400">No cargo crossings that day.</div>
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
                  {cargoTableRows.filter((r) => !isExcludedCrossingEvent(r)).map((r, idx) => {
                    const selected = selectedCrossingShipIdSet.has(r.shipId);
                    return (
                    <tr
                      key={`${r.shipId}-${r.t}-${idx}`}
                      className={`border-t border-slate-800 cursor-pointer ${selected ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}
                      onClick={() => toggleSelectedCrossingShip(r.shipId)}
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
          <section id="candidate-dark-crossers" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
            <h2 className="text-lg font-medium">Likely Dark-Crossing Candidates — Tankers</h2>
            <p className="text-xs text-slate-400">Heuristic shortlist: ≥3 aligned approach points, dark &gt;6h, speed-plausibility weighted, excluding confirmed crossers.</p>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-100">High-conviction dark-crossing candidate events in daily bins</h3>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={candidateDailyHigh}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="hour"
                    ticks={candidateChartTicks}
                    tickFormatter={(v) => formatDayTick(v as string)}
                    minTickGap={40}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                  />
                  <YAxis allowDecimals={false} stroke="#94a3b8" />
                  <Tooltip
                    content={(props) => (
                      <DailyCandidateTooltip
                        active={props.active}
                        label={props.label as string | undefined}
                        payload={props.payload as ReadonlyArray<{ value?: number; name?: string; color?: string }> | undefined}
                        rows={highConfidenceCandidateEvents
                          .filter((c) => (!discardSuspectedSpoofing || !isSuspectedCandidateSpoofingEvent(c)) && props.label && isSameUtcDay(c.lastSeenAt, props.label as string))
                          .sort((a, b) => +new Date(a.lastSeenAt) - +new Date(b.lastSeenAt))}
                        shipMeta={data?.shipMeta}
                      />
                    )}
                  />
                  {showWestToEast ? <Bar stackId="direction" dataKey="west_to_east" fill="#f97316" name="West → East" /> : null}
                  {showEastToWest ? <Bar stackId="direction" dataKey="east_to_west" fill="#38bdf8" name="East → West" /> : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Binned by each historical candidate event&apos;s last seen UTC timestamp before the dark gap began, split by inferred travel direction.
            </div>
          </div>
          <div className="mt-2 max-h-56 overflow-auto border border-slate-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 sticky top-0">
                <tr>
                  <th className="text-left p-2">Sel</th>
                  <th className="text-left p-2">Only</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Ship</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "lastSeen", dir: s.key === "lastSeen" && s.dir === "asc" ? "desc" : "asc" }))}>Last seen</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "darkHours", dir: s.key === "darkHours" && s.dir === "asc" ? "desc" : "asc" }))}>Dark h</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "score", dir: s.key === "score" && s.dir === "asc" ? "desc" : "asc" }))}>Score</th>
                  <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "confidence", dir: s.key === "confidence" && s.dir === "asc" ? "desc" : "asc" }))}>Conf</th>
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
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                        onClick={() => setSelectedCandidateShipIds([c.shipId])}
                      >
                        only
                      </button>
                    </td>
                    <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${c.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(c.shipName, data?.shipMeta?.[c.shipId]?.flag)}</a></td>
                    <td className="p-2">{new Date(c.lastSeenAt).toUTCString()}</td>
                    <td className="p-2">{c.darkHours.toFixed(1)}</td>
                    <td className="p-2 font-medium">{c.score.toFixed(1)}</td>
                    <td className="p-2">{c.confidenceBand === "high" ? "high" : c.confidenceBand === "low" ? "low" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </section>
        </section>

        <section id="crossing-paths" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-lg font-medium">
              {mapMode === "confirmed" ? "Crossings Map — Confirmed Tanker Crossings" : "Crossings Map — Likely Dark-Crossing Candidates"}
            </h2>
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setMapMode("confirmed")}
                className={`rounded-md border px-3 py-1.5 ${mapMode === "confirmed" ? "border-emerald-300 text-emerald-200 bg-emerald-500/10" : "border-slate-700 text-slate-400"}`}
              >
                Confirmed tanker crossings
              </button>
              <button
                onClick={() => setMapMode("candidates")}
                className={`rounded-md border px-3 py-1.5 ${mapMode === "candidates" ? "border-amber-300 text-amber-200 bg-amber-500/10" : "border-slate-700 text-slate-400"}`}
              >
                Dark-crossing candidates
              </button>
            </div>
          </div>
          {mapMode === "confirmed" ? (
            <>
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
                {selectedCrossingShipIds.length ? <button onClick={resetSelectedCrossingShips} className="px-2 py-1 rounded border border-slate-600 text-slate-300">reset selection</button> : null}
              </div>
              <div className="text-xs text-slate-300">
                Showing {crossingSummary.crossings} crossings across {crossingSummary.ships} ships under the current filters.
              </div>
              <div className="h-[560px] rounded-xl overflow-hidden border border-slate-800">
                <CrossingPathsMap
                  paths={crossingMapPaths}
                  eastLon={data.metadata.eastLon}
                  westLon={data.metadata.westLon}
                  linkLines={crossingMapLinkLines}
                  selectedShipIds={selectedCrossingShipIds}
                  onToggleShip={toggleSelectedCrossingShip}
                  onResetSelection={resetSelectedCrossingShips}
                />
              </div>
              <p className="text-xs text-slate-400">GPS can be weak in this area, so some points may jump inland. Dots are connected with straight lines, so routes can visually cross land even when ships did not.</p>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
                <div>
                  Showing {crossingDetailRows.length} confirmed crossing row{crossingDetailRows.length === 1 ? "" : "s"} in the table.
                </div>
                <button
                  type="button"
                  onClick={() => setHideSpoofingDetectedCrossings((value) => !value)}
                  className={`rounded border px-2 py-1 ${hideSpoofingDetectedCrossings ? "border-rose-300 text-rose-200" : "border-slate-700 text-slate-400"}`}
                >
                  hide spoofing-detected crossings: {hideSpoofingDetectedCrossings ? "on" : "off"}
                </button>
              </div>
              <div className="max-h-[420px] overflow-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Sel</th>
                      <th className="text-left p-2">Only</th>
                      <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Ship</th>
                      <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "type", dir: s.key === "type" && s.dir === "asc" ? "desc" : "asc" }))}>Type</th>
                      <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "direction", dir: s.key === "direction" && s.dir === "asc" ? "desc" : "asc" }))}>Direction</th>
                      <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "timestamp", dir: s.key === "timestamp" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing timestamp (UTC)</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Event ID</th>
                      <th className="text-left p-2 cursor-pointer" onClick={() => setCrossingDetailSort((s) => ({ key: "transit", dir: s.key === "transit" && s.dir === "asc" ? "desc" : "asc" }))}>Transit time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crossingDetailRows.map((r, idx) => {
                      const selected = selectedCrossingShipIdSet.has(r.shipId);
                      return (
                        <tr
                          key={`cross-detail-${r.shipId}-${r.t}-${idx}`}
                          className={`border-t border-slate-800 cursor-pointer ${selected ? "bg-slate-800/70" : "hover:bg-slate-800/40"}`}
                          onClick={() => toggleSelectedCrossingShip(r.shipId)}
                        >
                          <td className="p-2">{selected ? "●" : "○"}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                onlySelectedCrossingShip(r.shipId);
                              }}
                            >
                              only
                            </button>
                          </td>
                          <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${r.shipId}`} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>{formatShipDisplayName(r.shipName, data?.shipMeta?.[r.shipId]?.flag)} ({r.shipId})</a></td>
                          <td className="p-2">{r.vesselType}</td>
                          <td className="p-2">{r.direction.replace("_to_", " → ")}</td>
                          <td className="p-2">{new Date(r.t).toUTCString()}</td>
                          <td className="p-2">{isManuallyExcludedCrossingEvent(r) ? <span className="rounded-full border border-amber-700 bg-amber-950/40 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-200">manual spoofing exclusion</span> : isSuspectedSpoofingEvent(r) ? <span className="rounded-full border border-rose-700 bg-rose-950/40 px-2 py-1 text-[10px] uppercase tracking-wide text-rose-200">discarded suspected spoofing</span> : <span className="text-slate-500">kept</span>}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const copied = await copyText(r.eventId);
                                if (copied) {
                                  setCopiedCrossingEventId(r.eventId);
                                  setTimeout(() => setCopiedCrossingEventId((prev) => (prev === r.eventId ? null : prev)), 1500);
                                }
                              }}
                              title={r.eventId}
                            >
                              {copiedCrossingEventId === r.eventId ? "copied" : "copy id"}
                            </button>
                          </td>
                          <td className="p-2">{transitTimeByShip.get(r.shipId) || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 text-xs text-slate-300">
                <button
                  className={`px-2 py-1 rounded border ${showOnlySelectedCandidates ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-400"}`}
                  onClick={() => setShowOnlySelectedCandidates((v) => !v)}
                >
                  display only selected: {showOnlySelectedCandidates ? "on" : "off"}
                </button>
                <span>Selected: {selectedCandidateShipIds.length}</span>
                {selectedCandidateShipIds.length ? (
                  <button onClick={() => setSelectedCandidateShipIds(candidateCrossersForDisplay.filter((c) => c.confidenceBand === "high").map((c) => c.shipId))} className="px-2 py-1 rounded border border-slate-700 text-slate-400">reset to high-confidence</button>
                ) : null}
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
                    setSelectedCandidateShipIds(candidateCrossersForDisplay.filter((c) => c.confidenceBand === "high").map((c) => c.shipId))
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
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2 cursor-pointer" onClick={() => setCandidateSort((s) => ({ key: "confidence", dir: s.key === "confidence" && s.dir === "asc" ? "desc" : "asc" }))}>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateTableRows.map((c) => (
                      <tr key={`cand-map-${c.shipId}-${c.lastSeenAt}`} className="border-t border-slate-800">
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
                        <td className="p-2">{suspectedCandidateSpoofingKeys.has(`${c.shipId}|${c.lastSeenAt}|${c.inferredDirection}`) ? <span className="rounded-full border border-rose-700 bg-rose-950/40 px-2 py-1 text-[10px] uppercase tracking-wide text-rose-200">discarded suspected spoofing</span> : <span className="text-slate-500">kept</span>}</td>
                        <td className="p-2">{c.confidenceBand === "high" ? "high" : c.confidenceBand === "low" ? "low" : "no confidence"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section id="red-sea-crossings" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Red Sea crossings</div>
              <h2 className="mt-1 text-xl font-semibold text-slate-100">North and south inferred crossing flow</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Inferred crossings built only from the four Red Sea rectangles and source observations from <code className="text-slate-300">suez</code>, <code className="text-slate-300">red_sea</code>, and <code className="text-slate-300">yemen_channel</code>. Red Sea results are restricted to tankers and cargo vessels, use a 30-day lookback, trigger on the first qualifying anchor hit after a fresh prior-side sighting, and keep a 72-hour per-type cooldown as a secondary guardrail.
              </p>
            </div>
            <div className="text-xs text-slate-400 lg:text-right">
              <div>Events loaded: {redSeaCrossingEvents.length}</div>
              <div>Routes loaded: {redSeaCrossingRoutes.length}</div>
              <div>Latest crossing: {redSeaLatestTs ? new Date(redSeaLatestTs).toUTCString() : "Not available yet"}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-200 mr-2">Vessel types</span>
            {RED_SEA_VESSEL_TYPES.map((type) => {
              const active = selectedRedSeaVesselTypeSet.has(type);
              return (
                <button
                  key={`red-sea-vessel-${type}`}
                  type="button"
                  onClick={() => setSelectedRedSeaVesselTypes((prev) => prev.includes(type) ? prev.filter((value) => value !== type) : [...prev, type])}
                  className={`px-2 py-1 rounded border ${active ? "border-slate-200" : "border-slate-700 opacity-50"}`}
                >
                  <span className={`inline-block w-3 h-3 rounded-full ${classForType(type)} mr-2`} />{type}
                </button>
              );
            })}
            <span className="text-slate-200 ml-3 mr-2">Crossing types</span>
            {RED_SEA_CROSSING_TYPES.map((type) => {
              const active = selectedRedSeaTypeSet.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`px-2 py-1 rounded border ${active ? "border-slate-400 bg-slate-800 text-slate-100" : "border-slate-700 text-slate-400"}`}
                  onClick={() => setSelectedRedSeaCrossingTypes((prev) => prev.includes(type) ? prev.filter((value) => value !== type) : [...prev, type])}
                >
                  {RED_SEA_CROSSING_TYPE_LABELS[type]}
                </button>
              );
            })}
            {(["24h", "48h", "all"] as const).map((window) => (
              <button
                key={window}
                type="button"
                className={`px-2 py-1 rounded border ${redSeaWindow === window ? "border-emerald-300 text-emerald-200" : "border-slate-700 text-slate-400"}`}
                onClick={() => setRedSeaWindow(window)}
              >
                {window}
              </button>
            ))}
            <span className="text-slate-400">Selected: {selectedRedSeaEventIds.length}</span>
            {selectedRedSeaEventIds.length ? (
              <button
                type="button"
                className="px-2 py-1 rounded border border-slate-600 text-slate-300"
                onClick={resetSelectedRedSeaEvents}
              >
                reset selection
              </button>
            ) : null}
            <button
              type="button"
              className="px-2 py-1 rounded border border-slate-700 text-slate-300"
              onClick={() => {
                setSelectedRedSeaVesselTypes(["tanker"]);
                setSelectedRedSeaCrossingTypes(RED_SEA_CROSSING_TYPES);
                setRedSeaWindow("24h");
              }}
            >
              reset filters
            </button>
          </div>

          <div className="text-xs text-slate-300">
            Showing {redSeaSummary.crossings} crossings across {redSeaSummary.ships} ships under the current filters.
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {RED_SEA_CROSSING_TYPES.map((type) => (
              <div key={type} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{RED_SEA_CROSSING_TYPE_LABELS[type]}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-100">{redSeaVisibleCounts[type]}</div>
                <div className="mt-1 text-xs text-slate-400">{redSeaWindowLabel}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium text-slate-100">Daily crossing counts — Red Sea crossings [{redSeaMatrixVesselLabel}]</h3>
                  <p className="text-xs text-slate-400">Split into a 2x2 matrix by side and direction, with one daily series per crossing bucket.</p>
                </div>
              </div>
            <div className="grid gap-4 md:grid-cols-2">
              {RED_SEA_CROSSING_CHART_MATRIX.map(({ crossingType, side, flow }) => (
                <div key={`red-sea-chart-${crossingType}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{side}</div>
                      <h4 className="text-sm font-medium text-slate-100">{flow}</h4>
                    </div>
                    <div
                      className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em]"
                      style={{
                        borderColor: RED_SEA_CROSSING_TYPE_COLORS[crossingType],
                        color: RED_SEA_CROSSING_TYPE_COLORS[crossingType],
                      }}
                    >
                      {RED_SEA_CROSSING_TYPE_LABELS[crossingType]}
                    </div>
                  </div>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={filteredRedSeaCrossingsByDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                        <XAxis
                          dataKey="day"
                          tickFormatter={(v) => formatDayTick(v as string)}
                          minTickGap={24}
                          stroke="#94a3b8"
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis stroke="#94a3b8" allowDecimals={false} />
                        <Tooltip
                          labelFormatter={(v) => new Date(v as string).toUTCString()}
                          contentStyle={{ background: "#020617", border: "1px solid #334155" }}
                        />
                        <Bar
                          dataKey={crossingType}
                          fill={RED_SEA_CROSSING_TYPE_COLORS[crossingType]}
                          name={RED_SEA_CROSSING_TYPE_LABELS[crossingType]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium text-slate-100">Crossing events</h3>
                  <p className="text-xs text-slate-400">Select rows to show route geometry on the map.</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>Selected: {selectedRedSeaEventIds.length}</span>
                  {selectedRedSeaEventIds.length ? (
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-slate-300"
                      onClick={() => setSelectedRedSeaEventIds([])}
                    >
                      reset selection
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr>
                      <th className="p-2 text-left">Sel</th>
                      <th className="p-2 text-left">Only</th>
                      <th className="p-2 text-left cursor-pointer" onClick={() => setRedSeaSort((s) => ({ key: "ship", dir: s.key === "ship" && s.dir === "asc" ? "desc" : "asc" }))}>Ship</th>
                      <th className="p-2 text-left cursor-pointer" onClick={() => setRedSeaSort((s) => ({ key: "vessel", dir: s.key === "vessel" && s.dir === "asc" ? "desc" : "asc" }))}>Vessel</th>
                      <th className="p-2 text-left cursor-pointer" onClick={() => setRedSeaSort((s) => ({ key: "crossing", dir: s.key === "crossing" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing</th>
                      <th className="p-2 text-left cursor-pointer" onClick={() => setRedSeaSort((s) => ({ key: "time", dir: s.key === "time" && s.dir === "asc" ? "desc" : "asc" }))}>Crossing time (UTC)</th>
                      <th className="p-2 text-left">Prior zone</th>
                      <th className="p-2 text-left">Anchor zone</th>
                      <th className="p-2 text-left cursor-pointer" onClick={() => setRedSeaSort((s) => ({ key: "lookback", dir: s.key === "lookback" && s.dir === "asc" ? "desc" : "asc" }))}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redSeaEventRows.map((event) => {
                      const selected = selectedRedSeaEventIdSet.has(event.eventId);
                      return (
                        <tr key={event.eventId} className="border-t border-slate-800">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelectedRedSeaEvent(event.eventId)}
                            />
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                              onClick={() => onlySelectedRedSeaEvent(event.eventId)}
                            >
                              only
                            </button>
                          </td>
                          <td className="p-2"><a href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:${event.shipId}`} target="_blank" rel="noreferrer" className="underline">{formatShipDisplayName(event.shipName, event.flag)} ({event.shipId})</a></td>
                          <td className="p-2">{event.vesselType}</td>
                          <td className="p-2">{RED_SEA_CROSSING_TYPE_LABELS[event.crossingType]}</td>
                          <td className="p-2">{new Date(event.crossingTime || event.t).toUTCString()}</td>
                          <td className="p-2">{event.priorZone}<div className="text-[10px] text-slate-500">{new Date(event.priorTime).toUTCString()}</div></td>
                          <td className="p-2">{event.anchorZone}</td>
                          <td className="p-2">{event.deltaDh || `${event.lookbackHours.toFixed(1)}h`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <h3 className="mb-3 text-lg font-medium text-slate-100">Crossing routes map</h3>
              <div className="h-[420px] rounded-lg border border-slate-800 overflow-hidden">
                <RedSeaCrossingMap
                  routes={filteredRedSeaCrossingRoutes}
                  selectedEventIds={selectedRedSeaEventIds}
                  onToggleEvent={toggleSelectedRedSeaEvent}
                  onResetSelection={resetSelectedRedSeaEvents}
                />
              </div>
            </div>
          </div>
        </section>

        <section id="newsfeed" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Regional news intelligence</div>
              <h2 className="mt-1 text-xl font-semibold text-slate-100">Fresh summary, daily summaries, and source log</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                A cleaner regional intelligence layer: one fresh summary, recent daily summaries, and a source-by-source log of what the dashboard is using over time.
              </p>
            </div>
            <div className="text-xs text-slate-400 md:text-right">
              <div>Profile: {newsFeed?.metadata?.profile || "hormuz-news"}</div>
              <div>Items loaded: {newsFeed?.metadata?.itemCount ?? 0}</div>
              <div>New this run: {newsFeed?.metadata?.newItemCount ?? 0}</div>
              <div>Last run: {newsFeed?.metadata?.lastRunAt ? new Date(newsFeed.metadata.lastRunAt).toUTCString() : "Not available yet"}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-rose-300">VESSEL ATTACKS · LAST 24H</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{vesselAttacksSummary?.headline || "No vessel-attack summary yet"}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {vesselAttacksSummary?.body || "The dedicated attacks artifact will write the rolling 24-hour attacks summary here, including a clear no-credible-fresh-attacks read when appropriate."}
              </p>
            </div>

            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">LATEST NEWS</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{newsFeed?.lastUpdateSummary?.headline || "No fresh summary yet"}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {newsFeed?.lastUpdateSummary?.body || "The latest run summary will appear here once the next browsing cycle writes it."}
              </p>
              <div className="mt-4 border-t border-emerald-900/40 pt-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/80">Rolling 24h</div>
                <div className="mt-2 text-sm font-semibold leading-5 text-slate-100">{newsFeed?.last24hSummary?.headline || "No 24h summary yet"}</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {newsFeed?.last24hSummary?.body || "The rolling 24-hour view will appear here once enough collected items exist."}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Previous day</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{newsFeed?.previousDaySummary?.headline || "No previous-day summary yet"}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {newsFeed?.previousDaySummary?.body || "The first successful update of a new UTC day will write a full previous-day summary here once the collector provides it."}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Earlier day</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{newsDays[1]?.headline || newsDays[0]?.headline || "No earlier-day summary yet"}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {newsDays[1]
                  ? `${new Date(newsDays[1].day).toUTCString().slice(0, 16)} — ${newsDays[1].items.length} item${newsDays[1].items.length === 1 ? "" : "s"} in the source log for this day.`
                  : newsDays[0]
                    ? `${new Date(newsDays[0].day).toUTCString().slice(0, 16)} — ${newsDays[0].items.length} item${newsDays[0].items.length === 1 ? "" : "s"} in the source log for this day.`
                    : "As more days accumulate, the next most recent daily summary will appear here."}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Source log</div>
                <div className="mt-1 text-lg font-semibold text-slate-100">Datetime, source link, summary</div>
              </div>
              <div className="flex flex-col gap-2 md:items-end">
                <div className="text-xs text-slate-500">Most recent items first</div>
                <label className="text-xs text-slate-400">
                  <span className="mr-2">Filter by source</span>
                  <select
                    value={newsSourceFilter}
                    onChange={(e) => setNewsSourceFilter(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="all">All sources</option>
                    {newsSourceOptions.map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {(newsFeed?.items || []).length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                      <th className="p-2">Datetime</th>
                      <th className="p-2">Source</th>
                      <th className="p-2">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNewsItems.map((item) => (
                      <tr key={item.id} className="border-t border-slate-800 align-top">
                        <td className="p-2 whitespace-nowrap text-slate-400">{new Date(item.publishedAt).toUTCString()}</td>
                        <td className="p-2">
                          <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-cyan-300 underline underline-offset-2 hover:text-cyan-200">
                            {item.title}
                          </a>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{deriveNewsDisplaySource(item)}</div>
                        </td>
                        <td className="p-2 text-slate-300">{item.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-4 text-sm text-slate-400">
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
              ["red_sea", "Red Sea"],
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
