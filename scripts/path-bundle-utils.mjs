const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(value) {
  if (!value) return null;
  const ts = +new Date(value);
  return Number.isFinite(ts) ? ts : null;
}

export function latestCrossingReferenceTime(crossingEvents = [], fallback = null) {
  let latestTs = null;
  for (const event of crossingEvents || []) {
    const ts = toMs(event?.t);
    if (!Number.isFinite(ts)) continue;
    if (latestTs == null || ts > latestTs) latestTs = ts;
  }
  if (latestTs != null) return new Date(latestTs).toISOString();
  const fallbackTs = toMs(fallback);
  return fallbackTs != null ? new Date(fallbackTs).toISOString() : new Date().toISOString();
}

export function selectCrossingPathsForBundle(crossingPaths = [], crossingEvents = [], {
  vesselType,
  windowDays = null,
  referenceTime = null,
} = {}) {
  const filteredByType = (crossingPaths || []).filter((path) => path?.shipId && path?.vesselType === vesselType);
  const referenceIso = latestCrossingReferenceTime(crossingEvents, referenceTime);

  if (windowDays == null) {
    const shipCount = new Set(filteredByType.map((path) => path.shipId)).size;
    return {
      crossingPaths: filteredByType,
      referenceTime: referenceIso,
      shipCount,
      pathCount: filteredByType.length,
    };
  }

  const cutoffTs = +new Date(referenceIso) - windowDays * DAY_MS;
  const recentShipIds = new Set(
    (crossingEvents || [])
      .filter((event) => event?.vesselType === vesselType)
      .filter((event) => {
        const ts = toMs(event?.t);
        return Number.isFinite(ts) && ts >= cutoffTs;
      })
      .map((event) => event.shipId),
  );

  const filtered = filteredByType.filter((path) => recentShipIds.has(path.shipId));
  return {
    crossingPaths: filtered,
    referenceTime: referenceIso,
    shipCount: recentShipIds.size,
    pathCount: filtered.length,
  };
}

export function buildCrossingPathBundleMetadata({
  vesselType,
  windowDays = null,
  referenceTime,
  shipCount,
  pathCount,
}) {
  return {
    vesselType,
    windowDays,
    windowLabel: windowDays == null ? 'all' : `${windowDays}d`,
    referenceTime,
    shipCount,
    pathCount,
  };
}

export function buildRedSeaRoutesBundleMetadata(redSeaCrossingRoutes = []) {
  return {
    shipCount: new Set((redSeaCrossingRoutes || []).map((route) => route?.shipId).filter(Boolean)).size,
    routeCount: (redSeaCrossingRoutes || []).length,
  };
}
