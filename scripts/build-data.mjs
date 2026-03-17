import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { getRedSeaCrossingZones } from '../src/lib/redSeaCrossingZones.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_SOURCE_ROOT = path.resolve(REPO_ROOT, '..');
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
  red_sea:
    process.env.RED_SEA_INDEX_URL ||
    'https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/red_sea/index.json',
};
const SOURCE_MODE = String(process.env.HORMUZ_SOURCE_MODE || 'local').trim().toLowerCase() === 'remote' ? 'remote' : 'local';
const SOURCE_ROOT = path.resolve(process.env.HORMUZ_SOURCE_ROOT || DEFAULT_SOURCE_ROOT);
const rawSourceMinAgeSeconds = Number(process.env.HORMUZ_SOURCE_MIN_AGE_SECONDS ?? '120');
const SOURCE_MIN_AGE_SECONDS = Number.isFinite(rawSourceMinAgeSeconds) && rawSourceMinAgeSeconds >= 0 ? rawSourceMinAgeSeconds : 120;
const SOURCE_MIN_AGE_MS = SOURCE_MIN_AGE_SECONDS * 1000;

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
const RED_SEA_CROSSING_SOURCE_REGIONS = new Set(['suez', 'red_sea', 'yemen_channel']);
const RED_SEA_CROSSING_TYPES = ['south_outbound', 'south_inbound', 'north_outbound', 'north_inbound'];
const RED_SEA_CROSSING_VESSEL_TYPES = new Set(['tanker', 'cargo']);
const RED_SEA_CROSSING_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const RED_SEA_CROSSING_DEDUPE_MS = 72 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RED_SEA_ROUTE_CONTEXT_MS = DAY_MS;
const RED_SEA_ROUTE_MAX_PRE_EVENT_MS = 14 * DAY_MS;

function hourBin(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function dayBin(iso) {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
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

function buildRedSeaCrossingEventId(event) {
  const shipId = String(event?.shipId || 'unknown').trim() || 'unknown';
  const crossingType = String(event?.crossingType || 'unknown').trim() || 'unknown';
  const crossingTime = String(event?.crossingTime || event?.t || 'unknown_time').trim() || 'unknown_time';
  const priorTime = String(event?.priorTime || 'unknown_prior').trim() || 'unknown_prior';
  const priorZone = String(event?.priorZone || 'unknown_prior_zone').trim() || 'unknown_prior_zone';
  const anchorZone = String(event?.anchorZone || 'unknown_anchor_zone').trim() || 'unknown_anchor_zone';
  return `redsea|${shipId}|${crossingType}|${crossingTime}|${priorTime}|${priorZone}|${anchorZone}`;
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

function pickMostRecentRedSeaPriorHit(lastSeenByZone, eligibleZones, anchorMs, cutoffMs) {
  let latest = null;
  for (const zoneId of eligibleZones) {
    const candidate = lastSeenByZone.get(zoneId) || null;
    if (!candidate || candidate.tMs >= anchorMs || candidate.tMs < cutoffMs) continue;
    if (!latest || candidate.tMs > latest.tMs) latest = candidate;
  }
  return latest;
}

function findObservationStartIndex(observations, targetMs) {
  let lo = 0;
  let hi = observations.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (observations[mid].tMs < targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function findObservationEndIndex(observations, targetMs) {
  let lo = 0;
  let hi = observations.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (observations[mid].tMs <= targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function getRedSeaRouteWindowRange(priorHit, anchorHit) {
  return {
    startMs: Math.max(priorHit.tMs - RED_SEA_ROUTE_CONTEXT_MS, anchorHit.tMs - RED_SEA_ROUTE_MAX_PRE_EVENT_MS),
    endMs: anchorHit.tMs + RED_SEA_ROUTE_CONTEXT_MS,
  };
}

function buildRedSeaRouteWindowPoints(observations, priorHit, anchorHit) {
  const { startMs, endMs } = getRedSeaRouteWindowRange(priorHit, anchorHit);
  const startIndex = findObservationStartIndex(observations, startMs);
  const endIndex = findObservationEndIndex(observations, endMs);
  const selectedPoints = [];
  const seen = new Set();

  for (let index = startIndex; index < endIndex; index++) {
    const obs = observations[index];
    const point = {
      t: obs.t,
      lat: obs.lat,
      lon: obs.lon,
      sourceRegion: obs.sourceRegion,
      zones: obs.zones || [],
    };
    const key = `${point.t}|${point.lat}|${point.lon}|${point.sourceRegion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selectedPoints.push(point);
  }

  return selectedPoints;
}

function collectRedSeaSourceRegionsSeen(observations, startMs, endMs) {
  const startIndex = findObservationStartIndex(observations, startMs);
  const endIndex = findObservationEndIndex(observations, endMs);
  const regions = new Set();

  for (let index = startIndex; index < endIndex; index++) {
    regions.add(observations[index].sourceRegion);
  }

  return [...regions].sort();
}

function createRedSeaCrossingsDayBucket(day) {
  return {
    day,
    south_outbound: 0,
    south_inbound: 0,
    north_outbound: 0,
    north_inbound: 0,
    total: 0,
  };
}

function buildContinuousRedSeaCrossingsByDay(redSeaCrossingEvents) {
  if (!redSeaCrossingEvents.length) return [];

  const countsByDay = new Map();
  for (const event of redSeaCrossingEvents) {
    if (!countsByDay.has(event.day)) {
      countsByDay.set(event.day, createRedSeaCrossingsDayBucket(event.day));
    }
    const bucket = countsByDay.get(event.day);
    bucket[event.crossingType] += 1;
    bucket.total += 1;
  }

  const dayMsValues = redSeaCrossingEvents.map((event) => +new Date(event.day));
  const firstDayMs = Math.min(...dayMsValues);
  const lastDayMs = Math.max(...dayMsValues);
  const series = [];

  for (let dayMs = firstDayMs; dayMs <= lastDayMs; dayMs += DAY_MS) {
    const day = new Date(dayMs).toISOString();
    series.push(countsByDay.get(day) || createRedSeaCrossingsDayBucket(day));
  }

  return series;
}

function buildRedSeaCrossings(redSeaSourceObservationsByShip, shipMeta) {
  const redSeaCrossingEvents = [];
  const redSeaCrossingRoutes = [];
  const redSeaCrossingShipIds = new Set();

  const addEventIfMatched = ({
    shipId,
    sourceObservations,
    currentHit,
    lastSeenByZone,
    lastAcceptedAnchorByType,
    crossingType,
    anchorZones,
    priorZones,
    cutoffMs,
  }) => {
    if (!anchorZones.includes(currentHit.zone)) return;

    const priorHit = pickMostRecentRedSeaPriorHit(lastSeenByZone, priorZones, currentHit.tMs, cutoffMs);
    if (!priorHit) return;

    const lastAcceptedAnchorMs = lastAcceptedAnchorByType.get(crossingType) || 0;
    if (lastAcceptedAnchorMs && currentHit.tMs - lastAcceptedAnchorMs < RED_SEA_CROSSING_DEDUPE_MS) {
      return;
    }

    const routePoints = buildRedSeaRouteWindowPoints(sourceObservations, priorHit, currentHit);
    const routeWindowRange = getRedSeaRouteWindowRange(priorHit, currentHit);
    const lookbackHours = Number(((currentHit.tMs - priorHit.tMs) / 36e5).toFixed(2));
    const event = {
      shipId,
      shipName: shipMeta[shipId]?.shipName || 'Unknown',
      vesselType: shipMeta[shipId]?.vesselType || 'other',
      flag: shipMeta[shipId]?.flag || '',
      crossingType,
      t: currentHit.t,
      crossingTime: currentHit.t,
      day: dayBin(currentHit.t),
      anchorZone: currentHit.zone,
      anchorTime: currentHit.t,
      anchorLat: currentHit.lat,
      anchorLon: currentHit.lon,
      anchorSourceRegion: currentHit.sourceRegion,
      priorZone: priorHit.zone,
      priorTime: priorHit.t,
      priorLat: priorHit.lat,
      priorLon: priorHit.lon,
      priorSourceRegion: priorHit.sourceRegion,
      lookbackHours,
      deltaDh: formatDeltaDh(lookbackHours),
      sourceRegionsSeen: collectRedSeaSourceRegionsSeen(sourceObservations, priorHit.tMs, currentHit.tMs),
      inferenceWindowDays: RED_SEA_CROSSING_LOOKBACK_MS / DAY_MS,
      routePointCount: routePoints.length,
    };
    event.eventId = buildRedSeaCrossingEventId(event);

    redSeaCrossingEvents.push(event);
    redSeaCrossingRoutes.push({
      eventId: event.eventId,
      shipId,
      shipName: event.shipName,
      vesselType: event.vesselType,
      flag: event.flag,
      crossingType,
      t: event.t,
      crossingTime: event.crossingTime,
      day: event.day,
      anchorZone: event.anchorZone,
      anchorTime: event.anchorTime,
      anchorLat: event.anchorLat,
      anchorLon: event.anchorLon,
      priorZone: event.priorZone,
      priorTime: event.priorTime,
      priorLat: event.priorLat,
      priorLon: event.priorLon,
      routeWindowHours: Number(((routeWindowRange.endMs - routeWindowRange.startMs) / 36e5).toFixed(2)),
      routeWindowStartTime: new Date(routeWindowRange.startMs).toISOString(),
      routeWindowEndTime: new Date(routeWindowRange.endMs).toISOString(),
      points: routePoints,
    });
    redSeaCrossingShipIds.add(shipId);
    lastAcceptedAnchorByType.set(crossingType, currentHit.tMs);
  };

  for (const [shipId, rawObservations] of redSeaSourceObservationsByShip.entries()) {
    if (!RED_SEA_CROSSING_VESSEL_TYPES.has(shipMeta[shipId]?.vesselType || '')) continue;

    const sourceObservations = rawObservations
      .slice()
      .sort((a, b) => +new Date(a.t) - +new Date(b.t))
      .map((obs) => ({
        ...obs,
        tMs: +new Date(obs.t),
        zones: getRedSeaCrossingZones(obs.lat, obs.lon),
      }));

    const zoneHits = [];
    for (let sourceIndex = 0; sourceIndex < sourceObservations.length; sourceIndex++) {
      const obs = sourceObservations[sourceIndex];
      for (const zone of obs.zones) {
        zoneHits.push({
          ...obs,
          zone,
          sourceIndex,
        });
      }
    }
    if (!zoneHits.length) continue;

    const lastSeenByZone = new Map();
    const lastAcceptedAnchorByType = new Map();

    for (const currentHit of zoneHits) {
      const cutoffMs = currentHit.tMs - RED_SEA_CROSSING_LOOKBACK_MS;

      addEventIfMatched({
        shipId,
        sourceObservations,
        currentHit,
        lastSeenByZone,
        lastAcceptedAnchorByType,
        crossingType: 'south_outbound',
        anchorZones: ['rs-south-out'],
        priorZones: ['rs-south-in', 'rs-north-in', 'rs-north-out'],
        cutoffMs,
      });
      addEventIfMatched({
        shipId,
        sourceObservations,
        currentHit,
        lastSeenByZone,
        lastAcceptedAnchorByType,
        crossingType: 'south_inbound',
        anchorZones: ['rs-south-in', 'rs-north-in', 'rs-north-out'],
        priorZones: ['rs-south-out'],
        cutoffMs,
      });
      addEventIfMatched({
        shipId,
        sourceObservations,
        currentHit,
        lastSeenByZone,
        lastAcceptedAnchorByType,
        crossingType: 'north_outbound',
        anchorZones: ['rs-north-out'],
        priorZones: ['rs-north-in', 'rs-south-out', 'rs-south-in'],
        cutoffMs,
      });
      addEventIfMatched({
        shipId,
        sourceObservations,
        currentHit,
        lastSeenByZone,
        lastAcceptedAnchorByType,
        crossingType: 'north_inbound',
        anchorZones: ['rs-north-in', 'rs-south-out', 'rs-south-in'],
        priorZones: ['rs-north-out'],
        cutoffMs,
      });

      lastSeenByZone.set(currentHit.zone, currentHit);
    }
  }

  redSeaCrossingEvents.sort((a, b) => +new Date(a.t) - +new Date(b.t));
  redSeaCrossingRoutes.sort((a, b) => +new Date(a.t) - +new Date(b.t));

  return {
    redSeaCrossingEvents,
    redSeaCrossingsByDay: buildContinuousRedSeaCrossingsByDay(redSeaCrossingEvents),
    redSeaCrossingRoutes,
    redSeaCrossingShipIds,
  };
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

function buildRegionFileRegex(regionId) {
  const esc = regionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc}_(\\d{4})_(\\d{2})_(\\d{2})_(\\d{2})_(\\d{2})_(\\d{2})\\.csv$`);
}

function parseRunTimeFromFile(regionId, name) {
  const m = name.match(buildRegionFileRegex(regionId));
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function fetchIndexFiles(url) {
  if (!url) return [];
  const indexRes = await fetch(url);
  if (!indexRes.ok) throw new Error(`Failed to fetch index ${url}: ${indexRes.status}`);
  const index = await indexRes.json();
  return (index.files || [])
    .map((file) => ({ ...file, source: 'remote' }))
    .slice()
    .sort((a, b) => new Date(a.run_utc) - new Date(b.run_utc));
}

async function loadLocalRegionFiles(regionId) {
  const entries = await fs.readdir(SOURCE_ROOT, { withFileTypes: true });
  const fileRe = buildRegionFileRegex(regionId);
  const cutoff = Date.now() - SOURCE_MIN_AGE_MS;
  const candidates = entries.filter((entry) => entry.isFile() && fileRe.test(entry.name));
  const files = await Promise.all(candidates.map(async (entry) => {
    const localPath = path.join(SOURCE_ROOT, entry.name);
    const st = await fs.stat(localPath);
    return {
      file: entry.name,
      run_utc: parseRunTimeFromFile(regionId, entry.name),
      bytes: st.size,
      mtime_utc: st.mtime.toISOString(),
      local_path: localPath,
      source: 'local',
      isStable: st.mtimeMs <= cutoff,
    };
  }));
  const stableFiles = files
    .filter((file) => file.run_utc && file.isStable)
    .map((file) => ({
      file: file.file,
      run_utc: file.run_utc,
      bytes: file.bytes,
      mtime_utc: file.mtime_utc,
      local_path: file.local_path,
      source: file.source,
    }))
    .sort((a, b) => new Date(a.run_utc) - new Date(b.run_utc));
  return {
    files: stableFiles,
    source: 'local',
    totalDiscovered: files.filter((file) => file.run_utc).length,
    skippedRecentCount: files.filter((file) => file.run_utc && !file.isStable).length,
  };
}

async function loadRegionFiles(regionId, indexUrl) {
  if (SOURCE_MODE !== 'remote') {
    try {
      const local = await loadLocalRegionFiles(regionId);
      if (local.files.length > 0) return local;
      console.warn(`No stable local files for ${regionId} in ${SOURCE_ROOT}; falling back to remote index`);
    } catch (err) {
      console.warn(`Local source scan failed for ${regionId}: ${err.message}. Falling back to remote index`);
    }
  }

  const remoteFiles = await fetchIndexFiles(indexUrl);
  return {
    files: remoteFiles,
    source: 'remote',
    totalDiscovered: remoteFiles.length,
    skippedRecentCount: 0,
  };
}

async function loadCsvText(file) {
  if (file.local_path) return fs.readFile(file.local_path, 'utf8');
  const res = await fetch(file.public_url);
  if (!res.ok) return null;
  return res.text();
}

async function main() {
  const regionFiles = {};
  const sourceModesByRegion = {};
  const regionDiscoveredFileCounts = {};
  const regionSkippedRecentCounts = {};
  for (const [regionId, indexUrl] of Object.entries(INDEX_URLS)) {
    try {
      const catalog = await loadRegionFiles(regionId, indexUrl);
      regionFiles[regionId] = catalog.files;
      sourceModesByRegion[regionId] = catalog.source;
      regionDiscoveredFileCounts[regionId] = catalog.totalDiscovered;
      regionSkippedRecentCounts[regionId] = catalog.skippedRecentCount;
    } catch (err) {
      console.warn(`Skipping region ${regionId}: ${err.message}`);
      regionFiles[regionId] = [];
      sourceModesByRegion[regionId] = 'unavailable';
      regionDiscoveredFileCounts[regionId] = 0;
      regionSkippedRecentCounts[regionId] = 0;
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
  const redSeaSourceObservationsByShip = new Map();
  const snapshots = [];

  const hormuzFiles = regionFiles.hormuz || [];

  for (const [regionId, files] of Object.entries(regionFiles)) {
    for (const [index, file] of files.entries()) {
      let csvText = null;
      try {
        csvText = await loadCsvText(file);
      } catch (err) {
        console.warn(`Skipping unreadable ${regionId} source ${file.file || file.object_path || file.public_url}: ${err.message}`);
        continue;
      }
      if (!csvText) continue;
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

        if (RED_SEA_CROSSING_SOURCE_REGIONS.has(regionId)) {
          if (!redSeaSourceObservationsByShip.has(shipId)) redSeaSourceObservationsByShip.set(shipId, []);
          redSeaSourceObservationsByShip.get(shipId).push(obs);
        }

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

      if ((index + 1) % 10 === 0 || index + 1 === files.length) {
        console.log(`Processed ${regionId} ${index + 1}/${files.length} files`);
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
    for (const id of [...redSeaSourceObservationsByShip.keys()]) {
      if (!allowedShipIds.has(id)) redSeaSourceObservationsByShip.delete(id);
    }
    for (const snap of snapshots) {
      snap.points = snap.points.filter((p) => allowedShipIds.has(p.shipId));
    }
  }

  const {
    redSeaCrossingEvents,
    redSeaCrossingsByDay,
    redSeaCrossingRoutes,
    redSeaCrossingShipIds,
  } = buildRedSeaCrossings(redSeaSourceObservationsByShip, shipMeta);

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
  const EASTERN_REGIONS = ['hormuz_east', 'suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai', 'red_sea'];
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
      } else if (['suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai', 'red_sea'].includes(obs.sourceRegion)) {
        regionDetected = obs.sourceRegion;
      }

      if (!regionDetected) continue;
      if (!zonePresenceByShip.has(shipId)) zonePresenceByShip.set(shipId, []);
      zonePresenceByShip.get(shipId).push({ t: obs.t, region: regionDetected, lat: obs.lat, lon: obs.lon });
    }
  }

  const linkageEvents = [];
  const targetRegions = ['hormuz_east', 'suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai', 'red_sea'];

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
      if (!['suez', 'malacca', 'cape_good_hope', 'yemen_channel', 'south_sri_lanka', 'mumbai', 'red_sea'].includes(o.sourceRegion)) continue;
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
    sourceModeRequested: SOURCE_MODE,
    sourceModeUsedByRegion: sourceModesByRegion,
    sourceRoot: SOURCE_MODE === 'remote' ? null : SOURCE_ROOT,
    sourceMinAgeSeconds: SOURCE_MIN_AGE_SECONDS,
    sourceIndexUrl: sourceModesByRegion.hormuz === 'remote' ? INDEX_URLS.hormuz : null,
    sourceIndexes: Object.fromEntries(Object.entries(INDEX_URLS).map(([regionId, indexUrl]) => [
      regionId,
      sourceModesByRegion[regionId] === 'remote' ? indexUrl : null,
    ])),
    eastLon: EAST_LON,
    westLon: WEST_LON,
    westMinLon: WEST_MIN_LON,
    minLat: MIN_LAT,
    fileCount: hormuzFiles.length,
    regionFileCounts: Object.fromEntries(Object.entries(regionFiles).map(([k, v]) => [k, v.length])),
    regionDiscoveredFileCounts,
    regionSkippedRecentCounts,
    latestByRegion,
    shipCount: Object.keys(shipMeta).length,
    crossingShipCount: mergedCrossingShipIds.size,
    crossingEventCount: mergedCrossingEvents.length,
    redSeaCrossingShipCount: redSeaCrossingShipIds.size,
    redSeaCrossingEventCount: redSeaCrossingEvents.length,
    redSeaCrossingRouteCount: redSeaCrossingRoutes.length,
    redSeaCrossingLookbackDays: RED_SEA_CROSSING_LOOKBACK_MS / (24 * 3600 * 1000),
    redSeaCrossingDedupeHours: RED_SEA_CROSSING_DEDUPE_MS / 36e5,
    redSeaCrossingSourceRegions: [...RED_SEA_CROSSING_SOURCE_REGIONS],
    linkageEventCount: dedupedLinkageEvents.length,
    externalPresenceCount: externalPresencePoints.length,
    vesselTypeFilter: KEEP_ALL_VESSEL_TYPES ? 'all' : ALLOWED_VESSEL_TYPES,
  };

  const coreRelevantShipIds = new Set();
  for (const e of mergedCrossingEvents) coreRelevantShipIds.add(e.shipId);
  for (const p of mergedCrossingPaths) coreRelevantShipIds.add(p.shipId);
  for (const e of redSeaCrossingEvents) coreRelevantShipIds.add(e.shipId);
  for (const p of redSeaCrossingRoutes) coreRelevantShipIds.add(p.shipId);
  for (const l of dedupedLinkageEvents) coreRelevantShipIds.add(l.shipId);

  const minimalShipMeta = (id) => ({ flag: shipMeta[id]?.flag || '' });

  const coreShipMeta = {};
  for (const id of coreRelevantShipIds) {
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
    redSeaCrossingTypes: RED_SEA_CROSSING_TYPES,
    redSeaCrossingsByDay,
    redSeaCrossingEvents,
    redSeaCrossingRoutes,
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
      redSeaIndexRunCount: regionFiles.red_sea?.length || 0,
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
    const ids = new Set(coreRelevantShipIds);
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
        redSeaCrossingTypes: RED_SEA_CROSSING_TYPES,
        redSeaCrossingsByDay,
        redSeaCrossingEvents,
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
    wrap(
      'paths',
      {
        crossingPaths: mergedCrossingPaths,
        redSeaCrossingRoutes,
      },
      'all',
      {
        pathCount: mergedCrossingPaths.length,
        redSeaRouteCount: redSeaCrossingRoutes.length,
      },
    ),
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
    ...coreRelevantShipIds,
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

  console.log(`Wrote public/data split v2 files (source=${SOURCE_MODE}, root=${SOURCE_MODE === 'remote' ? 'remote' : SOURCE_ROOT})`);
}

export {
  buildContinuousRedSeaCrossingsByDay,
  buildRedSeaCrossings,
  buildRedSeaRouteWindowPoints,
  getRedSeaRouteWindowRange,
  pickMostRecentRedSeaPriorHit,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
