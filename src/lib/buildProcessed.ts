import Papa from "papaparse";

const EAST_LON = 56.4;
const WEST_LON = 56.15;

function hourBin(iso: string) {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function sideFromLon(lon: number) {
  if (lon >= EAST_LON) return "east" as const;
  if (lon <= WEST_LON) return "west" as const;
  return null;
}

function modal(entries: string[], fallback = "unknown") {
  if (!entries.length) return fallback;
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e, (counts.get(e) || 0) + 1);
  let best = fallback;
  let max = -1;
  for (const [k, v] of counts.entries()) {
    if (v > max) {
      best = k;
      max = v;
    }
  }
  return best;
}

function normalizeShipName(name: string) {
  const n = String(name || "").trim();
  if (!n || n === "0" || n === "00000") return "Unknown";
  return n;
}

function classifyVesselType(shipTypeCode: string) {
  const n = Number(shipTypeCode);
  if (Number.isNaN(n)) return "other";
  const map: Record<number, string> = {
    0: "unknown",
    1: "reserved",
    2: "wing_in_ground",
    3: "special",
    4: "high_speed",
    5: "special",
    6: "passenger",
    7: "cargo",
    8: "tanker",
    9: "other",
  };
  return map[n] || "other";
}

export async function buildProcessedData(indexUrl: string) {
  const indexRes = await fetch(indexUrl, { cache: "no-store" });
  if (!indexRes.ok) throw new Error(`Failed to fetch index: ${indexRes.status}`);
  const index = await indexRes.json();
  const files = (index.files || []).slice().sort((a: any, b: any) => +new Date(a.run_utc) - +new Date(b.run_utc));

  const shipTypeVotes = new Map<string, string[]>();
  const shipNameVotes = new Map<string, string[]>();
  const observationsByShip = new Map<string, any[]>();
  const snapshots: any[] = [];

  for (const file of files) {
    const res = await fetch(file.public_url, { cache: "no-store" });
    if (!res.ok) continue;
    const csvText = await res.text();
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const points: any[] = [];
    for (const row of parsed.data as any[]) {
      const shipId = String(row.ship_id || "").trim();
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      const capture = row.capture_utc || file.run_utc;
      if (!shipId || Number.isNaN(lat) || Number.isNaN(lon) || !capture) continue;

      const vesselType = classifyVesselType(row.ship_type);
      const shipName = normalizeShipName(row.ship_name);

      if (String(row.ship_type || "").trim() !== "") {
        if (!shipTypeVotes.has(shipId)) shipTypeVotes.set(shipId, []);
        shipTypeVotes.get(shipId)!.push(vesselType);
      }

      if (!shipNameVotes.has(shipId)) shipNameVotes.set(shipId, []);
      shipNameVotes.get(shipId)!.push(shipName);

      const obs = { t: capture, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
      if (!observationsByShip.has(shipId)) observationsByShip.set(shipId, []);
      observationsByShip.get(shipId)!.push(obs);

      points.push({ shipId, shipName, vesselType, lat: obs.lat, lon: obs.lon });
    }

    snapshots.push({ t: file.run_utc, points });
  }

  const shipMeta: Record<string, { vesselType: string; shipName: string }> = {};
  const allShipIds = new Set([...observationsByShip.keys(), ...shipNameVotes.keys(), ...shipTypeVotes.keys()]);
  for (const shipId of allShipIds) {
    shipMeta[shipId] = {
      vesselType: modal(shipTypeVotes.get(shipId) || [], "other"),
      shipName: modal((shipNameVotes.get(shipId) || []).filter((n) => n !== "Unknown"), "Unknown"),
    };
  }

  for (const snap of snapshots) {
    for (const p of snap.points) {
      const meta = shipMeta[p.shipId];
      if (!meta) continue;
      p.vesselType = meta.vesselType;
      if (!p.shipName || p.shipName === "Unknown") p.shipName = meta.shipName;
    }
  }

  const crossingEvents: any[] = [];
  const crossingShipIds = new Set<string>();
  const crossingPaths: any[] = [];

  for (const [shipId, obs] of observationsByShip.entries()) {
    obs.sort((a, b) => +new Date(a.t) - +new Date(b.t));
    let lastDefinedSide: "east" | "west" | null = null;
    let hasCrossing = false;
    const directionCounts = { east_to_west: 0, west_to_east: 0 };

    for (const point of obs) {
      const side = sideFromLon(point.lon);
      if (!side) continue;
      if (lastDefinedSide && side !== lastDefinedSide) {
        const direction = `${lastDefinedSide}_to_${side}`;
        crossingEvents.push({
          t: point.t,
          hour: hourBin(point.t),
          shipId,
          shipName: shipMeta[shipId]?.shipName || "Unknown",
          vesselType: shipMeta[shipId]?.vesselType || "other",
          direction,
        });
        (directionCounts as any)[direction] += 1;
        hasCrossing = true;
      }
      lastDefinedSide = side;
    }

    if (hasCrossing) {
      crossingShipIds.add(shipId);
      let primaryDirection = "mixed";
      if (directionCounts.east_to_west > directionCounts.west_to_east) primaryDirection = "east_to_west";
      if (directionCounts.west_to_east > directionCounts.east_to_west) primaryDirection = "west_to_east";
      crossingPaths.push({
        shipId,
        shipName: shipMeta[shipId]?.shipName || "Unknown",
        vesselType: shipMeta[shipId]?.vesselType || "other",
        primaryDirection,
        directionCounts,
        points: obs,
      });
    }
  }

  const hourly = new Map<string, { hour: string; east_to_west: number; west_to_east: number }>();
  for (const event of crossingEvents) {
    if (!hourly.has(event.hour)) hourly.set(event.hour, { hour: event.hour, east_to_west: 0, west_to_east: 0 });
    (hourly.get(event.hour) as any)[event.direction] += 1;
  }

  const crossingsByHour = Array.from(hourly.values()).sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
  const vesselTypes = [...new Set(Object.values(shipMeta).map((m) => m.vesselType))].sort();

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceIndexUrl: indexUrl,
      eastLon: EAST_LON,
      westLon: WEST_LON,
      fileCount: files.length,
      shipCount: Object.keys(shipMeta).length,
      crossingShipCount: crossingShipIds.size,
      crossingEventCount: crossingEvents.length,
    },
    vesselTypes,
    shipMeta,
    snapshots,
    crossingEvents,
    crossingsByHour,
    crossingPaths,
  };
}
