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
  yemen_channel:
    process.env.YEMEN_CHANNEL_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/yemen_channel/index.json',
  south_sri_lanka:
    process.env.SOUTH_SRI_LANKA_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/south_sri_lanka/index.json',
  mumbai:
    process.env.MUMBAI_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/mumbai/index.json',
};

const EAST_LON = 56.4;
const WEST_LON = 56.15;
const WEST_MIN_LON = 47.5;
const MIN_LAT = 24;

// Default to energy/logistics-relevant vessel classes only.
// To re-enable all vessel classes, run build/upload with:
//   ALLOWED_VESSEL_TYPES="all"
const ALLOWED_VESSEL_TYPES = String(process.env.ALLOWED_VESSEL_TYPES || 'tanker,cargo')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const KEEP_ALL_VESSEL_TYPES = ALLOWED_VESSEL_TYPES.includes('all');

function hourBin(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function normalizeCrossingDirection(direction) {
  return direction === 'west_to_east' ? 'west_to_east' : 'east_to_west';
}

function buildCrossingEventId(event) {
  const shipId = String(event?.shipId || 'unknown').trim() || 'unknown';
  const timestamp = String(event?.t || '').trim() || 'unknown_time';
  const direction = normalizeCrossingDirection(event?.direction);
  return `${shipId}|${timestamp}|${direction}`;
}

async function loadConfirmedCrossingExclusions(configPath) {
  try {
    const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const items = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.confirmedCrossingExclusions)
        ? raw.confirmedCrossingExclusions
        : Array.isArray(raw?.confirmed_crossing_exclusions)
          ? raw.confirmed_crossing_exclusions
          : [];

    const normalized = [];
    const seen = new Set();
    for (const item of items) {
      const eventId = String(item?.eventId || item?.event_id || '').trim();
      if (!eventId || seen.has(eventId)) continue;
      seen.add(eventId);
      normalized.push({
        eventId,
        reason: String(item?.reason || 'suspected spoofing').trim() || 'suspected spoofing',
        note: String(item?.note || '').trim(),
        excludedAt: String(item?.excludedAt || item?.excluded_at || '').trim() || null,
      });
    }
    return normalized;
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

function sideFromPoint(lat, lon) {
  if (lat < MIN_LAT) return null;
  if (lon >= EAST_LON) return 'east';
  if (lon <= WEST_LON && lon >= WEST_MIN_LON) return 'west';
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function cosineTowardMidpoint(a, b, midpoint) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const mx = midpoint.lon - a.lon;
  const my = midpoint.lat - a.lat;
  const mag1 = Math.hypot(dx, dy);
  const mag2 = Math.hypot(mx, my);
  if (!mag1 || !mag2) return 0;
  return (dx * mx + dy * my) / (mag1 * mag2);
}

function formatDeltaDh(hours) {
  const sign = hours >= 0 ? '+' : '-';
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const d = Math.floor(totalMinutes / (24 * 60));
  const remAfterDays = totalMinutes % (24 * 60);
  const h = Math.floor(remAfterDays / 60);
  const m = remAfterDays % 60;
  return `${sign}${d}d:${String(h).padStart(2, '0')}h:${String(m).padStart(2, '0')}m`;
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

function scoreCandidateFromTail({ shipId, shipName, vesselType, points, shipMeta, darkHours }) {
  const centerLon = (EAST_LON + WEST_LON) / 2;
  const centerLat = 26.25;
  const tail = points.slice(-Math.min(6, points.length));
  if (tail.length < 3) return null;

  let aligned = 0;
  let speedQuality = 0;
  let segCount = 0;
  let towardCosineSum = 0;
  const segSpeeds = [];

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
  if (alignedPoints < 3) return null;

  const speedScore = segCount ? speedQuality / segCount : 0;
  const approachConfidence = Math.min(1, (alignedPoints / Math.max(3, tail.length)) * speedScore);
  const last = tail[tail.length - 1];
  const lastMidDistKm = haversineKm(last.lat, last.lon, centerLat, centerLon);
  if (lastMidDistKm > 300) return null;
  const proximityRaw = 1 - Math.min(1, lastMidDistKm / 160);
  const prev = tail[tail.length - 2];
  const prevMidDistKm = haversineKm(prev.lat, prev.lon, centerLat, centerLon);
  const approachDirectionRaw = Math.max(0, Math.min(1, (prevMidDistKm - lastMidDistKm) / 8));
  const avgTowardCosine = segCount ? towardCosineSum / segCount : 0;
  const tangentialPenalty = avgTowardCosine < 0.35 ? (0.35 - avgTowardCosine) * 5 : 0;
  const darknessScore = Math.min(18, Math.max(0, darkHours - 6) * 1.2);
  const directionScore = 25 * approachDirectionRaw;
  const proximityScore = 20 * proximityRaw;
  const approachScore = 55 * approachConfidence;
  const lastSegmentKnots = segSpeeds[segSpeeds.length - 1] ?? 0;
  const prevSegmentKnots = segSpeeds[segSpeeds.length - 2] ?? lastSegmentKnots;
  const acceleratingTowardStrait = lastSegmentKnots > prevSegmentKnots + 1 && approachDirectionRaw > 0.35;
  const deceleratingAway = lastSegmentKnots < 2.5 && approachDirectionRaw < 0.08;
  const readinessScore = acceleratingTowardStrait ? 4 : deceleratingAway ? -12 : 0;
  const postAnchoringPenalty = prevSegmentKnots < 1.5 && lastSegmentKnots > 2.5 && segCount < 3 ? 6 : 0;
  let score = approachScore + proximityScore + directionScore + readinessScore - tangentialPenalty - postAnchoringPenalty;
  score += darknessScore * 0.2;
  let confidenceBand = score > 50 ? 'high' : score >= 30 ? 'low' : 'no';
  if (lastMidDistKm > 90 && confidenceBand === 'high') confidenceBand = 'low';
  if (score < 30) return null;

  const inferredDirection = last.lon >= centerLon ? 'east_to_west' : 'west_to_east';

  return {
    shipId,
    shipName,
    vesselType,
    inferredDirection,
    score: Math.round(score * 10) / 10,
    confidenceBand,
    alignedPoints,
    speedQuality: Math.round(speedScore * 100) / 100,
    approachConfidence: Math.round(approachConfidence * 100) / 100,
    darkHours: Math.round(darkHours * 10) / 10,
    proximityRaw: Math.round(proximityRaw * 100) / 100,
    approachDirectionRaw: Math.round(approachDirectionRaw * 100) / 100,
    proximityScore: Math.round(proximityScore * 10) / 10,
    approachScore: Math.round(approachScore * 10) / 10,
    darknessScore: Math.round(darknessScore * 10) / 10,
    directionScore: Math.round(directionScore * 10) / 10,
    tangentialPenalty: Math.round(tangentialPenalty * 10) / 10,
    cosineTowardness: Math.round(avgTowardCosine * 100) / 100,
    readinessScore: Math.round(readinessScore * 10) / 10,
    onePointPostAnchoringPenalty: Math.round(postAnchoringPenalty * 10) / 10,
    lastSegmentKnots: Math.round(lastSegmentKnots * 10) / 10,
    prevSegmentKnots: Math.round(prevSegmentKnots * 10) / 10,
    lastSeenAt: last.t,
    lastLat: last.lat,
    lastLon: last.lon,
    points,
    flag: shipMeta[shipId]?.flag || '',
  };
}

function sortCandidates(a, b) {
  if (b.confidenceBand !== a.confidenceBand) {
    return (b.confidenceBand === 'high' ? 2 : b.confidenceBand === 'low' ? 1 : 0) - (a.confidenceBand === 'high' ? 2 : a.confidenceBand === 'low' ? 1 : 0);
  }
  return b.score - a.score;
}

function computeLikelyDarkCrossers(snapshots, shipMeta, crossingShipIds, allowedTypes = ['tanker']) {
  if (!snapshots?.length) return [];

  const latestTs = +new Date(snapshots[snapshots.length - 1].t);
  const byShip = new Map();

  for (const s of snapshots) {
    for (const p of s.points || []) {
      if (!allowedTypes.includes(p.vesselType)) continue;
      if (!byShip.has(p.shipId)) byShip.set(p.shipId, { shipName: p.shipName, vesselType: p.vesselType, points: [] });
      byShip.get(p.shipId).points.push({ t: s.t, lat: p.lat, lon: p.lon });
    }
  }

  const out = [];
  for (const [shipId, v] of byShip.entries()) {
    const pts = v.points.sort((a, b) => +new Date(a.t) - +new Date(b.t));
    if (pts.length < 3) continue;
    if (crossingShipIds.has(shipId)) continue;
    const last = pts[pts.length - 1];
    const darkHours = (latestTs - +new Date(last.t)) / (1000 * 60 * 60);
    if (darkHours <= 6) continue;
    const scored = scoreCandidateFromTail({ shipId, shipName: v.shipName, vesselType: v.vesselType, points: pts, shipMeta, darkHours });
    if (scored) out.push(scored);
  }

  return out.sort(sortCandidates).slice(0, 80);
}

function computeHistoricalDarkCrosserEvents(snapshots, shipMeta, crossingShipIds, allowedTypes = ['tanker']) {
  if (!snapshots?.length) return [];

  const latestTs = +new Date(snapshots[snapshots.length - 1].t);
  const byShip = new Map();

  for (const s of snapshots) {
    for (const p of s.points || []) {
      if (!allowedTypes.includes(p.vesselType)) continue;
      if (!byShip.has(p.shipId)) byShip.set(p.shipId, { shipName: p.shipName, vesselType: p.vesselType, points: [] });
      byShip.get(p.shipId).points.push({ t: s.t, lat: p.lat, lon: p.lon });
    }
  }

  const out = [];
  for (const [shipId, v] of byShip.entries()) {
    const pts = v.points.sort((a, b) => +new Date(a.t) - +new Date(b.t));
    if (pts.length < 3) continue;
    if (crossingShipIds.has(shipId)) continue;

    for (let i = 0; i < pts.length; i++) {
      const lastVisible = pts[i];
      const nextVisibleTs = i + 1 < pts.length ? +new Date(pts[i + 1].t) : latestTs;
      const gapHours = (nextVisibleTs - +new Date(lastVisible.t)) / (1000 * 60 * 60);
      if (gapHours <= 6) continue;

      const prefix = pts.slice(0, i + 1);
      const scored = scoreCandidateFromTail({
        shipId,
        shipName: v.shipName,
        vesselType: v.vesselType,
        points: prefix,
        shipMeta,
        darkHours: gapHours,
      });
      if (!scored) continue;

      out.push({
        ...scored,
        eventId: `${shipId}:${lastVisible.t}`,
        gapHours: Math.round(gapHours * 10) / 10,
        resumedAt: i + 1 < pts.length ? pts[i + 1].t : null,
        eventType: i + 1 < pts.length ? 'historical_gap' : 'open_gap',
      });
    }
  }

  return out.sort((a, b) => +new Date(a.lastSeenAt) - +new Date(b.lastSeenAt));
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
  const rawShipTypeVotes = new Map();
  const rawGtShipTypeVotes = new Map();
  const shipNameVotes = new Map();
  const flagVotes = new Map();
  const destinationVotes = new Map();
  const latestMetaByShip = new Map();
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
        const rawShipType = String(row.ship_type || '').trim();
        const rawGtShipType = String(row.gt_shiptype || '').trim();
        const flag = String(row.flag || '').trim();
        const destination = String(row.destination || '').trim();
        const elapsedMinutes = String(row.elapsed_minutes || '').trim();
        const lastSeenEstimatedUtc = String(row.last_seen_estimated_utc || '').trim();
        const speedRaw = String(row.speed_raw || '').trim();
        const courseRaw = String(row.course_raw || '').trim();

        if (rawShipType !== '') {
          if (!shipTypeVotes.has(shipId)) shipTypeVotes.set(shipId, []);
          shipTypeVotes.get(shipId).push(vesselType);
          if (!rawShipTypeVotes.has(shipId)) rawShipTypeVotes.set(shipId, []);
          rawShipTypeVotes.get(shipId).push(rawShipType);
        }
        if (rawGtShipType !== '') {
          if (!rawGtShipTypeVotes.has(shipId)) rawGtShipTypeVotes.set(shipId, []);
          rawGtShipTypeVotes.get(shipId).push(rawGtShipType);
        }
        if (!shipNameVotes.has(shipId)) shipNameVotes.set(shipId, []);
        shipNameVotes.get(shipId).push(shipName);
        if (flag) {
          if (!flagVotes.has(shipId)) flagVotes.set(shipId, []);
          flagVotes.get(shipId).push(flag);
        }
        if (destination) {
          if (!destinationVotes.has(shipId)) destinationVotes.set(shipId, []);
          destinationVotes.get(shipId).push(destination);
        }
        latestMetaByShip.set(shipId, {
          elapsedMinutes: elapsedMinutes === '' ? null : elapsedMinutes,
          lastSeenEstimatedUtc: lastSeenEstimatedUtc || null,
          speedRaw: speedRaw === '' ? null : speedRaw,
          courseRaw: courseRaw === '' ? null : courseRaw,
        });

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
            flag,
            destination,
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
  const allShipIds = new Set([
    ...observationsByShip.keys(),
    ...shipNameVotes.keys(),
    ...shipTypeVotes.keys(),
    ...flagVotes.keys(),
    ...destinationVotes.keys(),
    ...latestMetaByShip.keys(),
  ]);
  for (const shipId of allShipIds) {
    const latestMeta = latestMetaByShip.get(shipId) || {};
    shipMeta[shipId] = {
      vesselType: modal(shipTypeVotes.get(shipId) || [], 'other'),
      shipName: modal((shipNameVotes.get(shipId) || []).filter((n) => n !== 'Unknown'), 'Unknown'),
      flag: modal(flagVotes.get(shipId) || [], ''),
      destination: modal(destinationVotes.get(shipId) || [], ''),
      rawShipType: modal(rawShipTypeVotes.get(shipId) || [], ''),
      rawGtShipType: modal(rawGtShipTypeVotes.get(shipId) || [], ''),
      latestElapsedMinutes: latestMeta.elapsedMinutes ?? null,
      latestSeenEstimatedUtc: latestMeta.lastSeenEstimatedUtc ?? null,
      latestSpeedRaw: latestMeta.speedRaw ?? null,
      latestCourseRaw: latestMeta.courseRaw ?? null,
    };
  }

  for (const snap of snapshots) {
    for (const p of snap.points) {
      const meta = shipMeta[p.shipId];
      if (!meta) continue;
      p.vesselType = meta.vesselType;
      if (!p.shipName || p.shipName === 'Unknown') p.shipName = meta.shipName;
      if (!p.flag) p.flag = meta.flag || '';
      if (!p.destination) p.destination = meta.destination || '';
    }
  }

  if (!KEEP_ALL_VESSEL_TYPES) {
    const allowedShipIds = new Set(
      Object.entries(shipMeta)
        .filter(([, m]) => ALLOWED_VESSEL_TYPES.includes(m.vesselType))
        .map(([id]) => id),
    );

    for (const id of [...observationsByShip.keys()]) {
      if (!allowedShipIds.has(id)) observationsByShip.delete(id);
    }
    for (const id of [...hormuzObservationsByShip.keys()]) {
      if (!allowedShipIds.has(id)) hormuzObservationsByShip.delete(id);
    }
    for (const snap of snapshots) {
      snap.points = snap.points.filter((p) => allowedShipIds.has(p.shipId));
    }
  }

  const crossingEvents = [];
  const crossingShipIds = new Set();
  const crossingPaths = [];
  const confirmedCrossingExclusionsPath = path.resolve('config/confirmed-crossing-exclusions.json');
  const confirmedCrossingExclusions = await loadConfirmedCrossingExclusions(confirmedCrossingExclusionsPath);
  const manualExcludedCrossingEventIds = new Set(confirmedCrossingExclusions.map((item) => item.eventId));

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
        const crossingEvent = {
          t: point.t,
          hour: hourBin(point.t),
          shipId,
          shipName: shipMeta[shipId]?.shipName || 'Unknown',
          vesselType: shipMeta[shipId]?.vesselType || 'other',
          flag: shipMeta[shipId]?.flag || '',
          direction,
        };
        crossingEvent.eventId = buildCrossingEventId(crossingEvent);
        crossingEvent.manuallyExcluded = manualExcludedCrossingEventIds.has(crossingEvent.eventId);
        crossingEvents.push(crossingEvent);
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

      const allObs = observationsByShip.get(shipId) || obs;
      crossingPaths.push({
        shipId,
        shipName: shipMeta[shipId]?.shipName || 'Unknown',
        vesselType: shipMeta[shipId]?.vesselType || 'other',
        flag: shipMeta[shipId]?.flag || '',
        primaryDirection,
        directionCounts,
        points: allObs.map((x) => ({ t: x.t, lat: x.lat, lon: x.lon })),
      });
    }
  }

  // --- Inferred crossings from zone presence ---
  // If a vessel is seen in hormuz_west and then in ANY eastern region (or vice versa),
  // that confirms a strait crossing even if direct boundary observations were missed.
  const EASTERN_REGIONS = ['hormuz_east', 'suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai'];
  const inferredCrossingKeys = new Set();

  // Build zone timeline per ship across ALL regions for inference
  const zoneTimelineByShip = new Map();
  for (const [shipId, obsList] of observationsByShip.entries()) {
    for (const obs of obsList) {
      let regionDetected = null;
      if (obs.sourceRegion === 'hormuz') {
        const side = sideFromPoint(obs.lat, obs.lon);
        if (side === 'west') regionDetected = 'hormuz_west';
        if (side === 'east') regionDetected = 'hormuz_east';
      } else if (EASTERN_REGIONS.includes(obs.sourceRegion)) {
        regionDetected = obs.sourceRegion;
      }
      if (!regionDetected) continue;
      if (!zoneTimelineByShip.has(shipId)) zoneTimelineByShip.set(shipId, []);
      zoneTimelineByShip.get(shipId).push({ t: obs.t, region: regionDetected, lat: obs.lat, lon: obs.lon });
    }
  }

  for (const [shipId, events] of zoneTimelineByShip.entries()) {
    const sorted = events.slice().sort((a, b) => new Date(a.t) - new Date(b.t));
    let lastZoneType = null; // 'west' or 'east'
    let lastT = null;

    for (const ev of sorted) {
      const isWest = ev.region === 'hormuz_west';
      const isEast = EASTERN_REGIONS.includes(ev.region);
      if (!isWest && !isEast) continue;

      const currentType = isWest ? 'west' : 'east';
      if (lastZoneType && currentType !== lastZoneType) {
        const direction = lastZoneType === 'west' ? 'west_to_east' : 'east_to_west';
        const dedupKey = `${shipId}|${direction}|${ev.t}`;
        // Only add if not already captured by direct Hormuz boundary observation
        const directKey = `${shipId}|${direction}|${ev.t}`;
        if (!crossingEvents.some((e) => e.shipId === shipId && e.direction === direction && e.t === ev.t)) {
          inferredCrossingKeys.add(dedupKey);
          const crossingEvent = {
            t: ev.t,
            hour: hourBin(ev.t),
            shipId,
            shipName: shipMeta[shipId]?.shipName || 'Unknown',
            vesselType: shipMeta[shipId]?.vesselType || 'other',
            flag: shipMeta[shipId]?.flag || '',
            direction,
            inferred: true,
          };
          crossingEvent.eventId = buildCrossingEventId(crossingEvent);
          crossingEvent.manuallyExcluded = manualExcludedCrossingEventIds.has(crossingEvent.eventId);
          crossingEvents.push(crossingEvent);

          if (!crossingShipIds.has(shipId)) {
            crossingShipIds.add(shipId);
            // Gather all observations for this ship for the crossing path
            const allObs = observationsByShip.get(shipId) || [];
            const hormuzObs = hormuzObservationsByShip.get(shipId) || [];
            const combinedObs = [...hormuzObs, ...allObs]
              .sort((a, b) => new Date(a.t) - new Date(b.t))
              .filter((v, i, arr) => i === 0 || v.t !== arr[i - 1].t);
            crossingPaths.push({
              shipId,
              shipName: shipMeta[shipId]?.shipName || 'Unknown',
              vesselType: shipMeta[shipId]?.vesselType || 'other',
              flag: shipMeta[shipId]?.flag || '',
              primaryDirection: direction,
              directionCounts: { east_to_west: direction === 'east_to_west' ? 1 : 0, west_to_east: direction === 'west_to_east' ? 1 : 0 },
              points: combinedObs.map((x) => ({ t: x.t, lat: x.lat, lon: x.lon })),
              inferred: true,
            });
          }
        }
      }
      lastZoneType = currentType;
      lastT = ev.t;
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
      } else if (['suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai'].includes(obs.sourceRegion)) {
        regionDetected = obs.sourceRegion;
      }

      if (!regionDetected) continue;
      if (!zonePresenceByShip.has(shipId)) zonePresenceByShip.set(shipId, []);
      zonePresenceByShip.get(shipId).push({ t: obs.t, region: regionDetected, lat: obs.lat, lon: obs.lon });
    }
  }

  const linkageEvents = [];
  const targetRegions = ['hormuz_east', 'suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai'];

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
            flag: shipMeta[shipId]?.flag || '',
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
      if (!['suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai'].includes(o.sourceRegion)) continue;
      externalPresencePoints.push({
        shipId,
        shipName: shipMeta[shipId]?.shipName || 'Unknown',
        vesselType: shipMeta[shipId]?.vesselType || 'other',
        flag: shipMeta[shipId]?.flag || '',
        region: o.sourceRegion,
        t: o.t,
        lat: o.lat,
        lon: o.lon,
        linkedToHormuz: allHormuzShipIds.has(shipId),
      });
    }
  }

  const outDir = path.resolve('public/data');
  const prevCorePath = path.join(outDir, 'processed_core.json');
  const prevPathsPath = path.join(outDir, 'processed_paths.json');

  // Preserve "once crossed, always crossed" by merging previous crossing events/paths.
  let prevCrossingEvents = [];
  let prevCrossingPaths = [];
  try {
    const prevCore = JSON.parse(await fs.readFile(prevCorePath, 'utf8'));
    prevCrossingEvents = prevCore?.data?.crossingEvents || prevCore?.crossingEvents || [];
  } catch {}
  try {
    const prevPaths = JSON.parse(await fs.readFile(prevPathsPath, 'utf8'));
    prevCrossingPaths = prevPaths?.data?.crossingPaths || prevPaths?.crossingPaths || [];
  } catch {}

  const crossingEventKey = (e) => `${e.shipId}|${e.direction}|${e.t}`;
  const mergedCrossingEventMap = new Map();
  for (const rawEvent of [...prevCrossingEvents, ...crossingEvents]) {
    if (!rawEvent?.shipId || !rawEvent?.t || !rawEvent?.direction) continue;
    const event = {
      ...rawEvent,
      eventId: rawEvent?.eventId || buildCrossingEventId(rawEvent),
    };
    event.manuallyExcluded = manualExcludedCrossingEventIds.has(event.eventId);
    mergedCrossingEventMap.set(crossingEventKey(event), event);
  }
  const mergedCrossingEvents = [...mergedCrossingEventMap.values()].sort((a, b) => +new Date(a.t) - +new Date(b.t));

  const mergedPathsByShip = new Map();
  for (const p of [...prevCrossingPaths, ...crossingPaths]) {
    if (!p?.shipId) continue;
    if (!mergedPathsByShip.has(p.shipId)) {
      mergedPathsByShip.set(p.shipId, {
        shipId: p.shipId,
        shipName: p.shipName,
        vesselType: p.vesselType,
        flag: p.flag || '',
        primaryDirection: p.primaryDirection,
        directionCounts: { east_to_west: p.directionCounts?.east_to_west || 0, west_to_east: p.directionCounts?.west_to_east || 0 },
        points: [],
      });
    }
    const cur = mergedPathsByShip.get(p.shipId);
    if (p.shipName) cur.shipName = p.shipName;
    if (p.vesselType) cur.vesselType = p.vesselType;
    if (p.flag) cur.flag = p.flag;
    if (p.primaryDirection) cur.primaryDirection = p.primaryDirection;
    cur.directionCounts.east_to_west = Math.max(cur.directionCounts.east_to_west, p.directionCounts?.east_to_west || 0);
    cur.directionCounts.west_to_east = Math.max(cur.directionCounts.west_to_east, p.directionCounts?.west_to_east || 0);
    for (const pt of p.points || []) cur.points.push(pt);
  }
  const mergedCrossingPaths = [...mergedPathsByShip.values()].map((p) => {
    const seen = new Set();
    const points = [];
    for (const pt of p.points || []) {
      const key = `${pt.t}|${pt.lat}|${pt.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(pt);
    }
    points.sort((a, b) => +new Date(a.t) - +new Date(b.t));
    return { ...p, points };
  });

  const mergedCrossingsByHourMap = new Map();
  for (const event of mergedCrossingEvents) {
    if (!mergedCrossingsByHourMap.has(event.hour)) {
      mergedCrossingsByHourMap.set(event.hour, { hour: event.hour, east_to_west: 0, west_to_east: 0 });
    }
    if (event.direction === 'east_to_west') mergedCrossingsByHourMap.get(event.hour).east_to_west += 1;
    else mergedCrossingsByHourMap.get(event.hour).west_to_east += 1;
  }
  const mergedCrossingsByHour = [...mergedCrossingsByHourMap.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));

  const vesselTypes = KEEP_ALL_VESSEL_TYPES
    ? [...new Set(Object.values(shipMeta).map((m) => m.vesselType))].sort()
    : [...new Set(ALLOWED_VESSEL_TYPES)].sort();
  const generatedAt = new Date().toISOString();
  const latestByRegion = { hormuz: snapshots.length ? snapshots[snapshots.length - 1].t : null };
  for (const p of externalPresencePoints) {
    const prev = latestByRegion[p.region] ? +new Date(latestByRegion[p.region]) : 0;
    const cur = +new Date(p.t);
    if (!latestByRegion[p.region] || cur > prev) latestByRegion[p.region] = p.t;
  }

  const mergedCrossingShipIds = new Set(mergedCrossingPaths.map((p) => p.shipId));

  const baseMetadata = {
    generatedAt,
    sourceIndexUrl: INDEX_URLS.hormuz,
    sourceIndexes: INDEX_URLS,
    eastLon: EAST_LON,
    westLon: WEST_LON,
    westMinLon: WEST_MIN_LON,
    minLat: MIN_LAT,
    fileCount: hormuzFiles.length,
    regionFileCounts: Object.fromEntries(Object.entries(regionFiles).map(([k, v]) => [k, v.length])),
    latestByRegion,
    shipCount: Object.keys(shipMeta).length,
    crossingShipCount: mergedCrossingShipIds.size,
    crossingEventCount: mergedCrossingEvents.length,
    linkageEventCount: dedupedLinkageEvents.length,
    externalPresenceCount: externalPresencePoints.length,
    vesselTypeFilter: KEEP_ALL_VESSEL_TYPES ? 'all' : ALLOWED_VESSEL_TYPES,
  };

  const crossingAndLinkShipIds = new Set();
  for (const e of mergedCrossingEvents) crossingAndLinkShipIds.add(e.shipId);
  for (const p of mergedCrossingPaths) crossingAndLinkShipIds.add(p.shipId);
  for (const l of dedupedLinkageEvents) crossingAndLinkShipIds.add(l.shipId);

  const minimalShipMeta = (id) => ({ flag: shipMeta[id]?.flag || '' });

  const coreShipMeta = {};
  for (const id of crossingAndLinkShipIds) {
    if (shipMeta[id]) coreShipMeta[id] = minimalShipMeta(id);
  }

  const output = {
    metadata: baseMetadata,
    vesselTypes,
    shipMeta: coreShipMeta,
    snapshots,
    crossingEvents: mergedCrossingEvents,
    crossingsByHour: mergedCrossingsByHour,
    crossingPaths: mergedCrossingPaths,
    linkageEvents: dedupedLinkageEvents,
    externalPresencePoints,
  };

  const wrap = (fileKind, data, window = null, metadata = {}) => ({
    schemaVersion: 'v2',
    fileKind,
    window,
    generatedAt,
    sourceRun: {
      hormuzIndexRunCount: regionFiles.hormuz?.length || 0,
      suezIndexRunCount: regionFiles.suez?.length || 0,
      malaccaIndexRunCount: regionFiles.malacca?.length || 0,
      capeIndexRunCount: regionFiles.cape_good_hope?.length || 0,
    },
    metadata,
    data,
  });

  const selectSnapshotsWindow = (hours) => {
    if (hours === 'all') return snapshots;
    const cutoff = +new Date(generatedAt) - hours * 3600 * 1000;
    return snapshots.filter((s) => +new Date(s.t) >= cutoff);
  };

  const selectExternalWindow = (hours) => {
    if (hours === 'all') return externalPresencePoints;
    const cutoff = +new Date(generatedAt) - hours * 3600 * 1000;
    return externalPresencePoints.filter((p) => +new Date(p.t) >= cutoff);
  };

  const buildShipMetaForWindow = (hours) => {
    const ids = new Set(crossingAndLinkShipIds);
    const snaps = selectSnapshotsWindow(hours);
    const ext = selectExternalWindow(hours);
    for (const s of snaps) for (const p of s.points || []) ids.add(p.shipId);
    for (const p of ext) ids.add(p.shipId);
    const subset = {};
    for (const id of ids) {
      if (shipMeta[id]) subset[id] = minimalShipMeta(id);
    }
    return subset;
  };

  await fs.mkdir(outDir, { recursive: true });

  await writeJson(
    'confirmed_crossing_exclusions.json',
    {
      schemaVersion: 'v1',
      generatedAt,
      sourcePath: 'config/confirmed-crossing-exclusions.json',
      confirmedCrossingExclusions,
    },
  );

  async function writeJson(name, obj) {
    const finalPath = path.join(outDir, name);
    const tmpPath = path.join(outDir, `${name}.${process.pid}.${Date.now()}.tmp`);
    const payload = JSON.stringify(obj);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(tmpPath, payload);
    try {
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        await fs.mkdir(path.dirname(finalPath), { recursive: true });
        await fs.writeFile(finalPath, payload);
        try { await fs.unlink(tmpPath); } catch {}
        return;
      }
      throw err;
    }
  }

  // Split outputs only
  await writeJson(
    'processed_core.json',
    wrap(
      'core',
      {
        vesselTypes,
        shipMeta: coreShipMeta,
        crossingEvents: mergedCrossingEvents,
        crossingsByHour: mergedCrossingsByHour,
        linkageEvents: dedupedLinkageEvents,
        confirmedCrossingExclusions,
      },
      null,
      {
        ...baseMetadata,
        confirmedCrossingExclusionCount: confirmedCrossingExclusions.length,
        manuallyExcludedCrossingEventCount: mergedCrossingEvents.filter((event) => event.manuallyExcluded).length,
      },
    ),
  );

  await writeJson(
    'processed_paths.json',
    wrap('paths', { crossingPaths: mergedCrossingPaths }, 'all', { pathCount: mergedCrossingPaths.length }),
  );

  const tankerCandidates = computeLikelyDarkCrossers(snapshots, shipMeta, mergedCrossingShipIds, ['tanker']);
  const cargoCandidates = computeLikelyDarkCrossers(snapshots, shipMeta, mergedCrossingShipIds, ['cargo']);
  const tankerCandidateEvents = computeHistoricalDarkCrosserEvents(snapshots, shipMeta, mergedCrossingShipIds, ['tanker']);
  const cargoCandidateEvents = computeHistoricalDarkCrosserEvents(snapshots, shipMeta, mergedCrossingShipIds, ['cargo']);
  const relevantShipIds = new Set([
    ...mergedCrossingShipIds,
    ...tankerCandidates.map((c) => c.shipId),
    ...cargoCandidates.map((c) => c.shipId),
    ...tankerCandidateEvents.map((c) => c.shipId),
    ...cargoCandidateEvents.map((c) => c.shipId),
  ]);
  const relevantExternalPoints = externalPresencePoints.filter((p) => relevantShipIds.has(p.shipId));
  const latestSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const latestExternalPoints = latestSnapshot
    ? externalPresencePoints.filter((p) => p.t === latestSnapshot.t)
    : [];
  const latestSnapshotShipMeta = {};
  for (const id of new Set([
    ...crossingAndLinkShipIds,
    ...relevantShipIds,
    ...(latestSnapshot?.points || []).map((p) => p.shipId),
  ])) {
    if (shipMeta[id]) latestSnapshotShipMeta[id] = minimalShipMeta(id);
  }

  await writeJson(
    'processed_candidates.json',
    wrap('candidates', { tankerCandidates, cargoCandidates, tankerCandidateEvents, cargoCandidateEvents, relevantExternalPoints }, 'all', {
      tankerCount: tankerCandidates.length,
      cargoCount: cargoCandidates.length,
      tankerEventCount: tankerCandidateEvents.length,
      cargoEventCount: cargoCandidateEvents.length,
      externalPointCount: relevantExternalPoints.length,
    }),
  );

  await writeJson(
    'processed_playback_latest.json',
    wrap('playback', { snapshots: latestSnapshot ? [latestSnapshot] : [] }, 'latest', {
      snapshotCount: latestSnapshot ? 1 : 0,
      pointCount: latestSnapshot?.points?.length || 0,
      fromUtc: latestSnapshot?.t || null,
      toUtc: latestSnapshot?.t || null,
    }),
  );

  await writeJson(
    'processed_shipmeta_latest.json',
    wrap('shipmeta', { shipMeta: latestSnapshotShipMeta }, 'latest', {
      shipCount: Object.keys(latestSnapshotShipMeta).length,
      snapshotTimestamp: latestSnapshot?.t || null,
    }),
  );

  await writeJson(
    'processed_external_latest.json',
    wrap('external', { externalPresencePoints: latestExternalPoints }, 'latest', {
      pointCount: latestExternalPoints.length,
      fromUtc: latestSnapshot?.t || null,
      toUtc: latestSnapshot?.t || null,
    }),
  );

  for (const [label, hours] of [
    ['24h', 24],
    ['48h', 48],
  ]) {
    const snaps = selectSnapshotsWindow(hours);
    const pointCount = snaps.reduce((sum, s) => sum + (s.points?.length || 0), 0);
    await writeJson(
      `processed_playback_${label}.json`,
      wrap('playback', { snapshots: snaps }, label, {
        snapshotCount: snaps.length,
        pointCount,
        fromUtc: snaps.length ? snaps[0].t : null,
        toUtc: snaps.length ? snaps[snaps.length - 1].t : null,
      }),
    );

    const ext = selectExternalWindow(hours);
    await writeJson(
      `processed_external_${label}.json`,
      wrap('external', { externalPresencePoints: ext }, label, {
        pointCount: ext.length,
        fromUtc: ext.length ? ext[0].t : null,
        toUtc: ext.length ? ext[ext.length - 1].t : null,
      }),
    );

    const shipMetaWindow = buildShipMetaForWindow(hours);
    await writeJson(
      `processed_shipmeta_${label}.json`,
      wrap('shipmeta', { shipMeta: shipMetaWindow }, label, {
        shipCount: Object.keys(shipMetaWindow).length,
      }),
    );
  }

  console.log('Wrote public/data split v2 files');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
