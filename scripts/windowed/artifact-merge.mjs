import fs from 'node:fs/promises';
import path from 'node:path';

import { buildContinuousRedSeaCrossingsByDay } from '../build-data.mjs';

export const WINDOWED_OBJECTS = Object.freeze([
  'confirmed_crossing_exclusions.json',
  'processed_core.json',
  'processed_paths.json',
  'processed_candidates.json',
  'processed_playback_latest.json',
  'processed_shipmeta_latest.json',
  'processed_external_latest.json',
  'processed_playback_24h.json',
  'processed_shipmeta_24h.json',
  'processed_external_24h.json',
  'processed_playback_48h.json',
  'processed_shipmeta_48h.json',
  'processed_external_48h.json',
]);

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toMs(value) {
  const iso = toIso(value);
  return iso ? +new Date(iso) : null;
}

function inReplaceRange(value, startMs, endMs) {
  const valueMs = toMs(value);
  if (!Number.isFinite(valueMs)) return false;
  if (valueMs < startMs) return false;
  if (endMs !== null && valueMs >= endMs) return false;
  return true;
}

function buildCrossingEventKey(event) {
  return String(event?.eventId || `${event?.shipId || ''}|${event?.direction || ''}|${event?.t || ''}`);
}

function buildRedSeaEventKey(event) {
  return String(event?.eventId || `${event?.shipId || ''}|${event?.crossingType || ''}|${event?.crossingTime || event?.t || ''}`);
}

function buildCandidateEventKey(event) {
  return String(event?.eventId || `${event?.shipId || ''}:${event?.lastSeenAt || event?.t || ''}`);
}

function buildPathPointKey(point) {
  return `${point?.t || ''}|${point?.lat || ''}|${point?.lon || ''}`;
}

function buildLinkageKey(event) {
  return `${event?.shipId || ''}|${event?.fromRegion || ''}|${event?.toRegion || ''}`;
}

function dataOf(payload) {
  return payload?.data || {};
}

function metadataOf(payload) {
  return payload?.metadata || {};
}

function sourceRunOf(payload) {
  return payload?.sourceRun || null;
}

function generatedAtOf(payload) {
  return toIso(payload?.generatedAt || payload?.metadata?.generatedAt || new Date().toISOString());
}

function wrapFromTemplate(template, fileKind, data, metadata, { window = null, generatedAt = null, sourceRun = null } = {}) {
  const nextGeneratedAt = generatedAt || new Date().toISOString();
  return {
    schemaVersion: template?.schemaVersion || 'v2',
    fileKind,
    window,
    generatedAt: nextGeneratedAt,
    sourceRun: sourceRun ?? sourceRunOf(template) ?? null,
    metadata,
    data,
  };
}

async function loadJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

function mergeByReplaceRange(previousItems, recentItems, {
  replaceStartUtc,
  replaceEndUtc = null,
  getTimeValue,
  getKey,
  sort = null,
} = {}) {
  const startMs = +new Date(replaceStartUtc);
  const endMs = replaceEndUtc ? +new Date(replaceEndUtc) : null;
  const merged = new Map();

  for (const item of previousItems || []) {
    if (inReplaceRange(getTimeValue(item), startMs, endMs)) continue;
    merged.set(getKey(item), item);
  }

  for (const item of recentItems || []) {
    if (!inReplaceRange(getTimeValue(item), startMs, endMs)) continue;
    merged.set(getKey(item), item);
  }

  const values = [...merged.values()];
  if (sort) values.sort(sort);
  return values;
}

function normalizeCrossingEvents(events) {
  const deduped = new Map();
  for (const event of events || []) {
    deduped.set(buildCrossingEventKey(event), event);
  }

  return [...deduped.values()].sort((a, b) => {
    const delta = +new Date(a.t) - +new Date(b.t);
    if (delta !== 0) return delta;
    return buildCrossingEventKey(a).localeCompare(buildCrossingEventKey(b));
  });
}

function buildCrossingsByHour(crossingEvents) {
  const hourly = new Map();
  for (const event of crossingEvents || []) {
    const hour = event.hour || (() => {
      const date = new Date(event.t);
      date.setUTCMinutes(0, 0, 0);
      return date.toISOString();
    })();
    if (!hourly.has(hour)) {
      hourly.set(hour, { hour, east_to_west: 0, west_to_east: 0 });
    }
    hourly.get(hour)[event.direction] += 1;
  }
  return [...hourly.values()].sort((a, b) => +new Date(a.hour) - +new Date(b.hour));
}

function mergeShipMetaSubset(previousShipMeta, recentShipMeta, referencedShipIds) {
  const merged = {};
  for (const shipId of referencedShipIds) {
    if (previousShipMeta?.[shipId]) merged[shipId] = previousShipMeta[shipId];
    if (recentShipMeta?.[shipId]) merged[shipId] = recentShipMeta[shipId];
  }
  return merged;
}

function dedupeLinkageEvents(events) {
  const byKey = new Map();
  for (const event of events || []) {
    const key = buildLinkageKey(event);
    const previous = byKey.get(key);
    if (!previous || Math.abs(event.deltaHours) < Math.abs(previous.deltaHours)) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()].sort((a, b) => +new Date(b.hormuzWestTime) - +new Date(a.hormuzWestTime));
}

function mergeCrossingPaths(previousPaths, recentPaths, { replaceStartUtc, replaceEndUtc = null, crossingEvents = [] } = {}) {
  const startMs = +new Date(replaceStartUtc);
  const endMs = replaceEndUtc ? +new Date(replaceEndUtc) : null;
  const byShip = new Map();
  const crossingCountsByShip = new Map();

  for (const event of crossingEvents || []) {
    if (!crossingCountsByShip.has(event.shipId)) {
      crossingCountsByShip.set(event.shipId, { east_to_west: 0, west_to_east: 0 });
    }
    crossingCountsByShip.get(event.shipId)[event.direction] += 1;
  }

  for (const pathRecord of previousPaths || []) {
    byShip.set(pathRecord.shipId, {
      ...pathRecord,
      points: (pathRecord.points || []).filter((point) => !inReplaceRange(point.t, startMs, endMs)),
    });
  }

  for (const pathRecord of recentPaths || []) {
    const current = byShip.get(pathRecord.shipId) || {
      shipId: pathRecord.shipId,
      shipName: pathRecord.shipName,
      vesselType: pathRecord.vesselType,
      flag: pathRecord.flag || '',
      points: [],
    };
    const nextPoints = [
      ...(current.points || []),
      ...(pathRecord.points || []).filter((point) => inReplaceRange(point.t, startMs, endMs)),
    ];
    byShip.set(pathRecord.shipId, {
      ...current,
      shipName: pathRecord.shipName || current.shipName,
      vesselType: pathRecord.vesselType || current.vesselType,
      flag: pathRecord.flag || current.flag || '',
      points: nextPoints,
    });
  }

  const merged = [];
  for (const [shipId, pathRecord] of byShip.entries()) {
    const seen = new Set();
    const points = [];
    for (const point of (pathRecord.points || []).sort((a, b) => +new Date(a.t) - +new Date(b.t))) {
      const key = buildPathPointKey(point);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(point);
    }
    if (!points.length) continue;

    const directionCounts = crossingCountsByShip.get(shipId) || { east_to_west: 0, west_to_east: 0 };
    let primaryDirection = 'mixed';
    if (directionCounts.east_to_west > directionCounts.west_to_east) primaryDirection = 'east_to_west';
    if (directionCounts.west_to_east > directionCounts.east_to_west) primaryDirection = 'west_to_east';

    merged.push({
      shipId,
      shipName: pathRecord.shipName || 'Unknown',
      vesselType: pathRecord.vesselType || 'other',
      flag: pathRecord.flag || '',
      primaryDirection,
      directionCounts,
      points,
    });
  }

  return merged.sort((a, b) => a.shipId.localeCompare(b.shipId));
}

function mergeRedSeaRoutes(previousRoutes, recentRoutes, { replaceStartUtc, replaceEndUtc = null } = {}) {
  return mergeByReplaceRange(previousRoutes, recentRoutes, {
    replaceStartUtc,
    replaceEndUtc,
    getTimeValue: (route) => route.crossingTime || route.t,
    getKey: (route) => String(route.eventId || `${route.shipId}|${route.crossingType}|${route.crossingTime || route.t}`),
    sort: (a, b) => +new Date(a.t) - +new Date(b.t),
  });
}

function mergeCandidateEvents(previousEvents, recentEvents, { replaceStartUtc, replaceEndUtc = null } = {}) {
  return mergeByReplaceRange(previousEvents, recentEvents, {
    replaceStartUtc,
    replaceEndUtc,
    getTimeValue: (event) => event.lastSeenAt || event.t,
    getKey: buildCandidateEventKey,
    sort: (a, b) => +new Date(a.lastSeenAt || a.t) - +new Date(b.lastSeenAt || b.t),
  });
}

function mergeCorePayload(previousPayload, recentPayload, { replaceStartUtc, replaceEndUtc = null } = {}) {
  const previous = dataOf(previousPayload);
  const recent = dataOf(recentPayload);
  const generatedAt = generatedAtOf(recentPayload || previousPayload);

  const crossingEvents = normalizeCrossingEvents(mergeByReplaceRange(
    previous.crossingEvents || [],
    recent.crossingEvents || [],
    {
      replaceStartUtc,
      replaceEndUtc,
      getTimeValue: (event) => event.t,
      getKey: buildCrossingEventKey,
      sort: (a, b) => +new Date(a.t) - +new Date(b.t),
    },
  ));

  const redSeaCrossingEvents = mergeByReplaceRange(
    previous.redSeaCrossingEvents || [],
    recent.redSeaCrossingEvents || [],
    {
      replaceStartUtc,
      replaceEndUtc,
      getTimeValue: (event) => event.crossingTime || event.t,
      getKey: buildRedSeaEventKey,
      sort: (a, b) => +new Date(a.t) - +new Date(b.t),
    },
  );

  const preservedLinkageEvents = (previous.linkageEvents || []).filter((event) => {
    const anchorTime = Math.max(+new Date(event.hormuzWestTime || 0), +new Date(event.otherRegionTime || 0));
    return !inReplaceRange(anchorTime ? new Date(anchorTime).toISOString() : null, +new Date(replaceStartUtc), replaceEndUtc ? +new Date(replaceEndUtc) : null);
  });
  const linkageEvents = dedupeLinkageEvents([
    ...preservedLinkageEvents,
    ...(recent.linkageEvents || []),
  ]);

  const referencedShipIds = new Set([
    ...crossingEvents.map((event) => event.shipId),
    ...redSeaCrossingEvents.map((event) => event.shipId),
    ...linkageEvents.map((event) => event.shipId),
  ]);
  const shipMeta = mergeShipMetaSubset(previous.shipMeta || {}, recent.shipMeta || {}, referencedShipIds);
  const vesselTypes = [...new Set([
    ...(previous.vesselTypes || []),
    ...(recent.vesselTypes || []),
  ])].sort();
  const redSeaCrossingsByDay = buildContinuousRedSeaCrossingsByDay(redSeaCrossingEvents);
  const crossingsByHour = buildCrossingsByHour(crossingEvents);
  const confirmedCrossingExclusions = recent.confirmedCrossingExclusions || previous.confirmedCrossingExclusions || [];

  const metadata = {
    ...metadataOf(previousPayload),
    ...metadataOf(recentPayload),
    generatedAt,
    sourceStartUtc: metadataOf(recentPayload).sourceStartUtc || null,
    sourceEndUtc: metadataOf(recentPayload).sourceEndUtc || null,
    previousMergeEnabled: false,
    replaceStartUtc,
    replaceEndUtc,
    rollingStrategy: replaceEndUtc ? 'windowed_full_rerun_commit' : 'rolling_context_rewrite',
    shipCount: Object.keys(shipMeta).length,
    crossingEventCount: crossingEvents.length,
    redSeaCrossingEventCount: redSeaCrossingEvents.length,
    linkageEventCount: linkageEvents.length,
    manuallyExcludedCrossingEventCount: crossingEvents.filter((event) => event.manuallyExcluded).length,
  };

  return wrapFromTemplate(
    recentPayload || previousPayload,
    'core',
    {
      vesselTypes,
      shipMeta,
      crossingEvents,
      crossingsByHour,
      redSeaCrossingTypes: recent.redSeaCrossingTypes || previous.redSeaCrossingTypes || [],
      redSeaCrossingsByDay,
      redSeaCrossingEvents,
      linkageEvents,
      confirmedCrossingExclusions,
    },
    metadata,
    {
      window: recentPayload?.window || previousPayload?.window || null,
      generatedAt,
      sourceRun: sourceRunOf(recentPayload) || sourceRunOf(previousPayload) || null,
    },
  );
}

function mergePathsPayload(previousPayload, recentPayload, corePayload, { replaceStartUtc, replaceEndUtc = null } = {}) {
  const previous = dataOf(previousPayload);
  const recent = dataOf(recentPayload);
  const generatedAt = generatedAtOf(recentPayload || previousPayload);

  const crossingPaths = mergeCrossingPaths(
    previous.crossingPaths || [],
    recent.crossingPaths || [],
    {
      replaceStartUtc,
      replaceEndUtc,
      crossingEvents: corePayload.data.crossingEvents || [],
    },
  );

  const redSeaCrossingRoutes = mergeRedSeaRoutes(
    previous.redSeaCrossingRoutes || [],
    recent.redSeaCrossingRoutes || [],
    { replaceStartUtc, replaceEndUtc },
  );

  const metadata = {
    ...metadataOf(previousPayload),
    ...metadataOf(recentPayload),
    generatedAt,
    pathCount: crossingPaths.length,
    redSeaRouteCount: redSeaCrossingRoutes.length,
    replaceStartUtc,
    replaceEndUtc,
    rollingStrategy: replaceEndUtc ? 'windowed_full_rerun_commit' : 'rolling_context_rewrite',
  };

  return wrapFromTemplate(
    recentPayload || previousPayload,
    'paths',
    {
      crossingPaths,
      redSeaCrossingRoutes,
    },
    metadata,
    {
      window: 'all',
      generatedAt,
      sourceRun: sourceRunOf(recentPayload) || sourceRunOf(previousPayload) || null,
    },
  );
}

function mergeCandidatesPayload(previousPayload, recentPayload, { replaceStartUtc, replaceEndUtc = null } = {}) {
  const previous = dataOf(previousPayload);
  const recent = dataOf(recentPayload);
  const generatedAt = generatedAtOf(recentPayload || previousPayload);

  const tankerCandidateEvents = mergeCandidateEvents(
    previous.tankerCandidateEvents || [],
    recent.tankerCandidateEvents || [],
    { replaceStartUtc, replaceEndUtc },
  );
  const cargoCandidateEvents = mergeCandidateEvents(
    previous.cargoCandidateEvents || [],
    recent.cargoCandidateEvents || [],
    { replaceStartUtc, replaceEndUtc },
  );

  const metadata = {
    ...metadataOf(previousPayload),
    ...metadataOf(recentPayload),
    generatedAt,
    tankerCount: (recent.tankerCandidates || []).length,
    cargoCount: (recent.cargoCandidates || []).length,
    tankerEventCount: tankerCandidateEvents.length,
    cargoEventCount: cargoCandidateEvents.length,
    externalPointCount: (recent.relevantExternalPoints || []).length,
    replaceStartUtc,
    replaceEndUtc,
    rollingStrategy: replaceEndUtc ? 'windowed_full_rerun_commit' : 'rolling_context_rewrite',
  };

  return wrapFromTemplate(
    recentPayload || previousPayload,
    'candidates',
    {
      tankerCandidates: recent.tankerCandidates || [],
      cargoCandidates: recent.cargoCandidates || [],
      tankerCandidateEvents,
      cargoCandidateEvents,
      relevantExternalPoints: recent.relevantExternalPoints || [],
    },
    metadata,
    {
      window: 'all',
      generatedAt,
      sourceRun: sourceRunOf(recentPayload) || sourceRunOf(previousPayload) || null,
    },
  );
}

export async function mergeArtifactDirectories({
  previousDir,
  recentDir,
  outputDir,
  replaceStartUtc,
  replaceEndUtc = null,
} = {}) {
  if (!recentDir) throw new TypeError('mergeArtifactDirectories requires recentDir');
  if (!outputDir) throw new TypeError('mergeArtifactDirectories requires outputDir');
  if (!replaceStartUtc) throw new TypeError('mergeArtifactDirectories requires replaceStartUtc');

  const recentCore = await loadJson(path.join(recentDir, 'processed_core.json'));
  const recentPaths = await loadJson(path.join(recentDir, 'processed_paths.json'));
  const recentCandidates = await loadJson(path.join(recentDir, 'processed_candidates.json'));
  if (!recentCore || !recentPaths || !recentCandidates) {
    throw new Error('recent artifact directory is missing processed_core.json, processed_paths.json, or processed_candidates.json');
  }

  const previousCore = previousDir ? await loadJson(path.join(previousDir, 'processed_core.json')) : null;
  const previousPaths = previousDir ? await loadJson(path.join(previousDir, 'processed_paths.json')) : null;
  const previousCandidates = previousDir ? await loadJson(path.join(previousDir, 'processed_candidates.json')) : null;

  const mergedCore = mergeCorePayload(previousCore, recentCore, { replaceStartUtc, replaceEndUtc });
  const mergedPaths = mergePathsPayload(previousPaths, recentPaths, mergedCore, { replaceStartUtc, replaceEndUtc });
  const mergedCandidates = mergeCandidatesPayload(previousCandidates, recentCandidates, { replaceStartUtc, replaceEndUtc });

  await fs.mkdir(path.resolve(outputDir), { recursive: true });
  await writeJsonAtomic(path.join(outputDir, 'processed_core.json'), mergedCore);
  await writeJsonAtomic(path.join(outputDir, 'processed_paths.json'), mergedPaths);
  await writeJsonAtomic(path.join(outputDir, 'processed_candidates.json'), mergedCandidates);

  for (const fileName of [
    'confirmed_crossing_exclusions.json',
    'processed_playback_latest.json',
    'processed_shipmeta_latest.json',
    'processed_external_latest.json',
    'processed_playback_24h.json',
    'processed_shipmeta_24h.json',
    'processed_external_24h.json',
    'processed_playback_48h.json',
    'processed_shipmeta_48h.json',
    'processed_external_48h.json',
  ]) {
    const recentPath = path.join(recentDir, fileName);
    try {
      const payload = await fs.readFile(recentPath);
      await fs.mkdir(path.dirname(path.join(outputDir, fileName)), { recursive: true });
      await fs.writeFile(path.join(outputDir, fileName), payload);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return {
    processedCorePath: path.join(outputDir, 'processed_core.json'),
    processedPathsPath: path.join(outputDir, 'processed_paths.json'),
    processedCandidatesPath: path.join(outputDir, 'processed_candidates.json'),
    replaceStartUtc,
    replaceEndUtc,
  };
}
