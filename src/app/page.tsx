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

type DataShape = {
  metadata: {
    generatedAt: string;
    eastLon: number;
    westLon: number;
    fileCount: number;
    shipCount: number;
    crossingShipCount: number;
    crossingEventCount: number;
  };
  vesselTypes: string[];
  shipMeta: Record<string, { shipName: string; vesselType: string }>;
  snapshots: Snapshot[];
  crossingsByHour: CrossingHour[];
  crossingEvents: CrossingEvent[];
  crossingPaths: CrossingPath[];
};

const PlaybackMap = dynamic(() => import("@/components/PlaybackMap"), { ssr: false });
const CrossingPathsMap = dynamic(() => import("@/components/CrossingPathsMap"), { ssr: false });

function computeHourly(paths: CrossingPath[], eastLon: number, westLon: number) {
  const byHour = new Map<string, { hour: string; east_to_west: number; west_to_east: number }>();
  for (const ship of paths) {
    let lastSide: "east" | "west" | null = null;
    for (const p of ship.points) {
      const side = p.lon >= eastLon ? "east" : p.lon <= westLon ? "west" : null;
      if (!side) continue;
      if (lastSide && side !== lastSide) {
        const d = new Date(p.t);
        d.setUTCMinutes(0, 0, 0);
        const hour = d.toISOString();
        if (!byHour.has(hour)) byHour.set(hour, { hour, east_to_west: 0, west_to_east: 0 });
        if (lastSide === "east" && side === "west") byHour.get(hour)!.east_to_west += 1;
        if (lastSide === "west" && side === "east") byHour.get(hour)!.west_to_east += 1;
      }
      lastSide = side;
    }
  }
  return [...byHour.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
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
  const [crossingMapTypes, setCrossingMapTypes] = useState<string[]>(["tanker"]);

  useEffect(() => {
    const remoteUrl = process.env.NEXT_PUBLIC_HORMUZ_PROCESSED_URL;
    const candidates = [remoteUrl, "/data/processed.json"].filter(Boolean) as string[];

    const load = async () => {
      let json: any = null;
      for (const base of candidates) {
        try {
          const r = await fetch(`${base}?t=${Date.now()}`);
          if (!r.ok) continue;
          json = await r.json();
          if (json?.metadata && Array.isArray(json?.snapshots)) break;
        } catch {
          // try next candidate
        }
      }

      const normalized: DataShape = {
        metadata: json?.metadata || {
          generatedAt: new Date().toISOString(),
          eastLon: 56.4,
          westLon: 56.15,
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
      };

      setData(normalized);
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

  const tankerPaths = useMemo(() => filteredCrossingPaths.filter((p) => p.vesselType === "tanker"), [filteredCrossingPaths]);
  const cargoPaths = useMemo(() => filteredCrossingPaths.filter((p) => p.vesselType === "cargo"), [filteredCrossingPaths]);

  const allFilteredHourly = useMemo(() => {
    if (!data) return [];
    return computeHourly(filteredCrossingPaths, data.metadata.eastLon, data.metadata.westLon);
  }, [data, filteredCrossingPaths]);

  const tankerHourly = useMemo(() => {
    if (!data) return [];
    return computeHourly(tankerPaths, data.metadata.eastLon, data.metadata.westLon);
  }, [data, tankerPaths]);

  const cargoHourly = useMemo(() => {
    if (!data) return [];
    return computeHourly(cargoPaths, data.metadata.eastLon, data.metadata.westLon);
  }, [data, cargoPaths]);

  const sharedHours = useMemo(() => {
    if (!data || !data.snapshots?.length) return [] as string[];
    const start = toHourStartIso(data.snapshots[0].t);
    const end = toHourStartIso(data.snapshots[data.snapshots.length - 1].t);
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
    return filtered.sort((a, b) => +new Date(a.t) - +new Date(b.t));
  }, [data, selectedTankerHour]);

  const cargoTableRows = useMemo(() => {
    if (!data) return [] as CrossingEvent[];
    const rows = data.crossingEvents.filter((e) => e.vesselType === "cargo");
    const filtered = selectedCargoHour ? rows.filter((e) => e.hour === selectedCargoHour) : rows;
    return filtered.sort((a, b) => +new Date(a.t) - +new Date(b.t));
  }, [data, selectedCargoHour]);

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
          <div className="mb-3 inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
            Last ingested: {new Date(lastIngestedAt).toUTCString()}
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Strait of Hormuz Traffic Intelligence</h1>
          <div className="mt-2 inline-flex items-center rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
            BLK - SET team
          </div>
          <p className="mt-2 text-slate-400 text-sm">
            East boundary {data.metadata.eastLon}, west boundary {data.metadata.westLon}. Default selection is Cargo + Tanker.
          </p>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <Stat label="Files" value={String(data.metadata.fileCount)} />
            <Stat label="Vessels" value={String(data.metadata.shipCount)} />
            <Stat label="Crossing Tankers (last 48h)" value={String(last24hCrossingCounts.tanker)} />
            <Stat label="Crossing Cargo (last 48h)" value={String(last24hCrossingCounts.cargo)} />
            <Stat label="Crossing Others (last 48h)" value={String(last24hCrossingCounts.other)} />
          </div>
        </header>

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
              <button
                onClick={() => setPlaying((v) => !v)}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <span className="text-slate-400">{currentSnapshot?.t ? new Date(currentSnapshot.t).toUTCString() : "-"}</span>
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
            {[
              ["tanker", "bg-rose-500"],
              ["cargo", "bg-green-500"],
              ["other", "bg-amber-500"],
            ].map(([type, cls]) => {
              const active = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))}
                  className={`px-2 py-1 rounded border ${active ? "border-slate-200" : "border-slate-700 opacity-50"}`}
                >
                  <span className={`inline-block w-3 h-3 rounded-full ${cls} mr-2`} />{type}
                </button>
              );
            })}
            <button onClick={() => setShowCrossing((v) => !v)} className={`px-2 py-1 rounded border ${showCrossing ? "border-slate-200" : "border-slate-700 opacity-50"}`}>✕ crossing</button>
            <button onClick={() => setShowNonCrossing((v) => !v)} className={`px-2 py-1 rounded border ${showNonCrossing ? "border-slate-200" : "border-slate-700 opacity-50"}`}>● non-crossing</button>
          </div>

          <div className="h-[460px] rounded-xl overflow-hidden border border-slate-800">
            <PlaybackMap
              points={filteredCurrentPoints}
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
              crossingShipIds={crossingShipIds}
              showCrossing={showCrossing}
              showNonCrossing={showNonCrossing}
            />
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="xl:col-span-2 rounded-xl border border-amber-300/70 bg-amber-400/15 px-4 py-3 text-sm font-semibold text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]">
            <strong>Tankers</strong> are the vessels most likely to carry oil and gas. <strong>Cargo vessels</strong> are far less likely to be energy carriers.
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
                  <tr><th className="text-left p-2">Tanker ship</th><th className="text-left p-2">Crossing timestamp (UTC)</th></tr>
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
                  <tr><th className="text-left p-2">Cargo ship</th><th className="text-left p-2">Crossing timestamp (UTC)</th></tr>
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
          <h2 className="text-lg font-medium">{crossingMapTitle}</h2>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-200 mr-2">Legend (click to toggle)</span>
            {[
              ["tanker", "bg-rose-500"],
              ["cargo", "bg-green-500"],
              ["other", "bg-amber-500"],
            ].map(([type, cls]) => {
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
                  <span className={`inline-block w-3 h-3 rounded-full ${cls} mr-2`} />{type}
                </button>
              );
            })}
          </div>
          <div className="h-[560px] rounded-xl overflow-hidden border border-slate-800">
            <CrossingPathsMap
              paths={filteredCrossingPathsForMap.slice(0, 180)}
              eastLon={data.metadata.eastLon}
              westLon={data.metadata.westLon}
            />
          </div>
          <p className="text-xs text-slate-400">GPS can be weak in this area, so some points may jump inland. Dots are connected with straight lines, so routes can visually cross land even when ships did not.</p>
        </section>
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
