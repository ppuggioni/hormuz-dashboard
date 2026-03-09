import fs from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';

const INDEX_URLS = {
  hormuz:
    process.env.HORMUZ_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/index.json',
  suez:
    process.env.SUEZ_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/suez/index.json',
  malacca:
    process.env.MALACCA_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/malacca/index.json',
  cape_good_hope:
    process.env.CAPE_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/cape_good_hope/index.json',
};

const EAST_LON = 56.4;
const WEST_LON = 56.15;
const MIN_LAT = 24;

function hourBin(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function sideFromPoint(lat, lon) {
  if (lat < MIN_LAT) return null;
  if (lon >= EAST_LON) return 'east';
  if (lon <= WEST_LON) return 'west';
  return null;
}

function formatDeltaDh(hours) {
  const sign = hours >= 0 ? '+' : '-';
  const abs = Math.abs(hours);
  const d = Math.floor(abs / 24);
  const h = Math.floor(abs % 24);
  return `${sign}${d}:${String(h).padStart(2, '0')}`;
}

function modal(entries, fallback = 'unknown') {
  if (!entries.length) return fallback;
  const counts = new Map();
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

function normalizeShipName(name) {
  const n = String(name || '').trim();
  if (!n || n === '0' || n === '00000') return 'Unknown';
  return n;
}

function classifyVesselType(_gtShipType, shipTypeCode) {
  const n = Number(shipTypeCode);
  if (Number.isNaN(n)) return 'other';
  const map = {
    0: 'unknown',
    1: 'reserved',
    2: 'wing_in_ground',
    3: 'special',
    4: 'high_speed',
    5: 'special',
    6: 'passenger',
    7: 'cargo',
    8: 'tanker',
    9: 'other',
  };
  return map[n] || 'other';
}

async function fetchIndexFiles(url) {
  if (!url) return [];
  const indexRes = await fetch(url);
  if (!indexRes.ok) throw new Error(`Failed to fetch index ${url}: ${indexRes.status}`);
  const index = await indexRes.json();
  return (index.files || []).slice().sort((a, b) => new Date(a.run_utc) - new Date(b.run_utc));
}

async function main() {
  const regionFiles = {};
  for (const [regionId, indexUrl] of Object.entries(INDEX_URLS)) {
    try {
      regionFiles[regionId] = await fetchIndexFiles(indexUrl);
    } catch (err) {
      console.warn(`Skipping region ${regionId}: ${err.message}`);
      regionFiles[regionId] = [];
    }
  }

  const shipTypeVotes = new Map();
  const shipNameVotes = new Map();
  const observationsByShip = new Map();
  const hormuzObservationsByShip = new Map();
  const snapshots = [];

  const hormuzFiles = regionFiles.hormuz || [];

  for (const [regionId, files] of Object.entries(regionFiles)) {
    for (const [i, file] of files.entries()) {
      const res = await fetch(file.public_url);
      if (!res.ok) continue;
      const csvText = await res.text();
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

      const points = [];
      for (const row of parsed.data) {
        const shipId = String(row.ship_id || '').trim();
        const lat = Number(row.latitude);
        const lon = Number(row.longitude);
        const capture = row.capture_utc || file.run_utc;
        if (!shipId || Number.isNaN(lat) || Number.isNaN(lon) || !capture) continue;

        const vesselType = classifyVesselType(row.gt_shiptype, row.ship_type);
        const shipName = normalizeShipName(row.ship_name);

        if (String(row.ship_type || '').trim() !== '') {
          if (!shipTypeVotes.has(shipId)) shipTypeVotes.set(shipId, []);
          shipTypeVotes.get(shipId).push(vesselType);
        }
        if (!shipNameVotes.has(shipId)) shipNameVotes.set(shipId, []);
        shipNameVotes.get(shipId).push(shipName);

        const obs = {
          t: capture,
          lat: Number(lat.toFixed(5)),
          lon: Number(lon.toFixed(5)),
          sourceRegion: regionId,
        };

        if (!observationsByShip.has(shipId)) observationsByShip.set(shipId, []);
        observationsByShip.get(shipId).push(obs);

        if (regionId === 'hormuz') {
          if (!hormuzObservationsByShip.has(shipId)) hormuzObservationsByShip.set(shipId, []);
          hormuzObservationsByShip.get(shipId).push(obs);

          points.push({
            shipId,
            shipName,
            vesselType,
            lat: obs.lat,
            lon: obs.lon,
          });
        }
      }

      if (regionId === 'hormuz') {
        snapshots.push({ t: file.run_utc, points });
      }

      if ((i + 1) % 10 === 0 || i + 1 === files.length) {
        console.log(`Processed ${regionId} ${i + 1}/${files.length} files`);
      }
    }
  }

  const shipMeta = {};
  const allShipIds = new Set([...observationsByShip.keys(), ...shipNameVotes.keys(), ...shipTypeVotes.keys()]);
  for (const shipId of allShipIds) {
    shipMeta[shipId] = {
      vesselType: modal(shipTypeVotes.get(shipId) || [], 'other'),
      shipName: modal((shipNameVotes.get(shipId) || []).filter((n) => n !== 'Unknown'), 'Unknown'),
    };
  }

  for (const snap of snapshots) {
    for (const p of snap.points) {
      const meta = shipMeta[p.shipId];
      if (!meta) continue;
      p.vesselType = meta.vesselType;
      if (!p.shipName || p.shipName === 'Unknown') p.shipName = meta.shipName;
    }
  }

  const crossingEvents = [];
  const crossingShipIds = new Set();
  const crossingPaths = [];

  for (const [shipId, obs] of hormuzObservationsByShip.entries()) {
    obs.sort((a, b) => new Date(a.t) - new Date(b.t));
    let lastDefinedSide = null;
    let hasCrossing = false;
    const directionCounts = { east_to_west: 0, west_to_east: 0 };

    for (const point of obs) {
      const side = sideFromPoint(point.lat, point.lon);
      if (!side) continue;

      if (lastDefinedSide && side !== lastDefinedSide) {
        const direction = `${lastDefinedSide}_to_${side}`;
        crossingEvents.push({
          t: point.t,
          hour: hourBin(point.t),
          shipId,
          shipName: shipMeta[shipId]?.shipName || 'Unknown',
          vesselType: shipMeta[shipId]?.vesselType || 'other',
          direction,
        });
        directionCounts[direction] += 1;
        hasCrossing = true;
      }
      lastDefinedSide = side;
    }

    if (hasCrossing) {
      crossingShipIds.add(shipId);
      let primaryDirection = 'mixed';
      if (directionCounts.east_to_west > directionCounts.west_to_east) primaryDirection = 'east_to_west';
      if (directionCounts.west_to_east > directionCounts.east_to_west) primaryDirection = 'west_to_east';

      crossingPaths.push({
        shipId,
        shipName: shipMeta[shipId]?.shipName || 'Unknown',
        vesselType: shipMeta[shipId]?.vesselType || 'other',
        primaryDirection,
        directionCounts,
        points: obs.map((x) => ({ t: x.t, lat: x.lat, lon: x.lon })),
      });
    }
  }

  const hourly = new Map();
  for (const event of crossingEvents) {
    if (!hourly.has(event.hour)) hourly.set(event.hour, { hour: event.hour, east_to_west: 0, west_to_east: 0 });
    hourly.get(event.hour)[event.direction] += 1;
  }
  const crossingsByHour = Array.from(hourly.values()).sort((a, b) => new Date(a.hour) - new Date(b.hour));

  const zonePresenceByShip = new Map();
  const allHormuzShipIds = new Set(hormuzObservationsByShip.keys());
  for (const [shipId, obsList] of observationsByShip.entries()) {
    for (const obs of obsList) {
      let regionDetected = null;
      if (obs.sourceRegion === 'hormuz') {
        const side = sideFromPoint(obs.lat, obs.lon);
        if (side === 'west') regionDetected = 'hormuz_west';
        if (side === 'east') regionDetected = 'hormuz_east';
      } else if (['suez', 'malacca', 'cape_good_hope'].includes(obs.sourceRegion)) {
        regionDetected = obs.sourceRegion;
      }

      if (!regionDetected) continue;
      if (!zonePresenceByShip.has(shipId)) zonePresenceByShip.set(shipId, []);
      zonePresenceByShip.get(shipId).push({ t: obs.t, region: regionDetected, lat: obs.lat, lon: obs.lon });
    }
  }

  const linkageEvents = [];
  const targetRegions = ['hormuz_east', 'suez', 'malacca', 'cape_good_hope'];

  for (const [shipId, events] of zonePresenceByShip.entries()) {
    const sorted = events.slice().sort((a, b) => new Date(a.t) - new Date(b.t));
    const anchors = sorted.filter((e) => e.region === 'hormuz_west');
    if (!anchors.length) continue;

    for (const anchor of anchors) {
      const anchorTs = +new Date(anchor.t);
      for (const target of targetRegions) {
        const candidates = sorted.filter((e) => e.region === target);
        if (!candidates.length) continue;

        let before = null;
        let after = null;
        for (const c of candidates) {
          const ts = +new Date(c.t);
          if (ts <= anchorTs) before = c;
          if (ts >= anchorTs && !after) after = c;
        }

        const pair = [];
        if (before) pair.push(before);
        if (after && (!before || after.t !== before.t)) pair.push(after);

        for (const other of pair) {
          const deltaHours = (+new Date(other.t) - anchorTs) / 36e5;
          const fromRegion = deltaHours >= 0 ? 'hormuz_west' : target;
          const toRegion = deltaHours >= 0 ? target : 'hormuz_west';
          linkageEvents.push({
            shipId,
            shipName: shipMeta[shipId]?.shipName || 'Unknown',
            vesselType: shipMeta[shipId]?.vesselType || 'other',
            fromRegion,
            toRegion,
            hormuzWestTime: anchor.t,
            hormuzWestLat: anchor.lat,
            hormuzWestLon: anchor.lon,
            otherRegion: target,
            otherRegionTime: other.t,
            otherLat: other.lat,
            otherLon: other.lon,
            deltaHours: Number(deltaHours.toFixed(2)),
            deltaDh: formatDeltaDh(deltaHours),
          });
        }
      }
    }
  }

  // De-duplicate linkage rows so each ship has at most one row per route pair.
  // Keep the closest detection to Hormuz West (smallest absolute delta).
  const linkageByKey = new Map();
  for (const row of linkageEvents) {
    const key = `${row.shipId}|${row.fromRegion}|${row.toRegion}`;
    const prev = linkageByKey.get(key);
    if (!prev || Math.abs(row.deltaHours) < Math.abs(prev.deltaHours)) {
      linkageByKey.set(key, row);
    }
  }
  const dedupedLinkageEvents = [...linkageByKey.values()];
  dedupedLinkageEvents.sort((a, b) => +new Date(b.hormuzWestTime) - +new Date(a.hormuzWestTime));

  const externalPresencePoints = [];
  for (const [shipId, obsList] of observationsByShip.entries()) {
    for (const o of obsList) {
      if (!['suez', 'malacca', 'cape_good_hope'].includes(o.sourceRegion)) continue;
      externalPresencePoints.push({
        shipId,
        shipName: shipMeta[shipId]?.shipName || 'Unknown',
        vesselType: shipMeta[shipId]?.vesselType || 'other',
        region: o.sourceRegion,
        t: o.t,
        lat: o.lat,
        lon: o.lon,
        linkedToHormuz: allHormuzShipIds.has(shipId),
      });
    }
  }

  const vesselTypes = [...new Set(Object.values(shipMeta).map((m) => m.vesselType))].sort();

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceIndexUrl: INDEX_URLS.hormuz,
      sourceIndexes: INDEX_URLS,
      eastLon: EAST_LON,
      westLon: WEST_LON,
      minLat: MIN_LAT,
      fileCount: hormuzFiles.length,
      regionFileCounts: Object.fromEntries(Object.entries(regionFiles).map(([k, v]) => [k, v.length])),
      shipCount: Object.keys(shipMeta).length,
      crossingShipCount: crossingShipIds.size,
      crossingEventCount: crossingEvents.length,
      linkageEventCount: dedupedLinkageEvents.length,
      externalPresenceCount: externalPresencePoints.length,
    },
    vesselTypes,
    shipMeta,
    snapshots,
    crossingEvents,
    crossingsByHour,
    crossingPaths,
    linkageEvents: dedupedLinkageEvents,
    externalPresencePoints,
  };

  const outDir = path.resolve('public/data');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'processed.json'), JSON.stringify(output));
  console.log('Wrote public/data/processed.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
