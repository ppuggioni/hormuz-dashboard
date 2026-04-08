const COMBAT_REFERENCE = {
  label: 'Arabian Sea',
  lat: 17.5,
  lon: 65.5,
};

const LOCATION_REFERENCES = [
  { id: 'arabian_sea', label: 'Arabian Sea', lat: 17.5, lon: 65.5, combatZone: true, patterns: [/\barabian sea\b/i] },
  { id: 'gulf_of_oman', label: 'Gulf of Oman', lat: 24.5, lon: 59.8, combatZone: true, patterns: [/\bgulf of oman\b/i] },
  { id: 'gulf_of_aden', label: 'Gulf of Aden', lat: 13.0, lon: 48.0, combatZone: true, patterns: [/\bgulf of aden\b/i] },
  { id: 'red_sea', label: 'Red Sea', lat: 20.0, lon: 39.0, combatZone: true, patterns: [/\bred sea\b/i] },
  { id: 'persian_gulf', label: 'Persian Gulf', lat: 26.5, lon: 52.5, combatZone: true, patterns: [/\bpersian gulf\b/i, /\barabian gulf\b/i] },
  { id: 'mediterranean_sea', label: 'Mediterranean Sea', lat: 35.8, lon: 18.0, combatZone: false, patterns: [/\bmediterranean sea\b/i] },
  { id: 'strait_of_gibraltar', label: 'Strait of Gibraltar', lat: 36.0, lon: -5.5, combatZone: false, patterns: [/\bstrait of gibraltar\b/i, /\bgibraltar\b/i] },
  { id: 'souda_bay', label: 'Souda Bay, Greece', lat: 35.49, lon: 24.07, combatZone: false, patterns: [/\bsouda bay\b/i] },
  { id: 'croatia', label: 'Croatia', lat: 43.5, lon: 16.0, combatZone: false, patterns: [/\bcroatia\b/i] },
  { id: 'chesapeake_bay', label: 'Chesapeake Bay', lat: 37.5, lon: -76.1, combatZone: false, patterns: [/\bchesapeake bay\b/i] },
  { id: 'norfolk', label: 'Norfolk, Virginia', lat: 36.95, lon: -76.33, combatZone: false, patterns: [/\bnorfolk\b/i, /\bnaval station norfolk\b/i] },
  { id: 'mayport', label: 'Mayport, Florida', lat: 30.39, lon: -81.43, combatZone: false, patterns: [/\bmayport\b/i] },
  { id: 'caribbean_sea', label: 'Caribbean Sea', lat: 16.5, lon: -74.0, combatZone: false, patterns: [/\bcaribbean sea\b/i] },
  { id: 'atlantic_ocean', label: 'Atlantic Ocean', lat: 31.0, lon: -55.0, combatZone: false, patterns: [/\batlantic\b/i] },
  { id: 'pacific_ocean', label: 'Pacific Ocean', lat: 18.0, lon: -155.0, combatZone: false, patterns: [/\bpacific ocean\b/i, /\bin the pacific\b/i] },
  { id: 'philippine_sea', label: 'Philippine Sea', lat: 18.0, lon: 132.0, combatZone: false, patterns: [/\bphilippine sea\b/i] },
  { id: 'south_china_sea', label: 'South China Sea', lat: 14.0, lon: 113.0, combatZone: false, patterns: [/\bsouth china sea\b/i] },
  { id: 'japan', label: 'Japan', lat: 35.7, lon: 139.7, combatZone: false, patterns: [/\bin japan\b/i, /\byokosuka\b/i, /\bokinawa\b/i, /\bjapan\b/i] },
  { id: 'hawaii', label: 'Hawaii', lat: 21.3, lon: -157.8, combatZone: false, patterns: [/\bhawaii\b/i, /\bpearl harbor\b/i] },
];

const SHIP_REGEX = /\b(USS|USNS|USCGC)\s+([A-Z0-9][A-Za-z0-9.'’\-\s]+?)\s*\(([A-Z0-9\- ]{2,20})\)/g;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeShipName(value) {
  return normalizeWhitespace(String(value || '').replace(/\s+/g, ' '));
}

function inferVesselType(hull, sentence = '') {
  const normalizedHull = String(hull || '').toUpperCase().trim();
  if (/^CVN/.test(normalizedHull)) return 'aircraft carrier';
  if (/^LHD/.test(normalizedHull) || /^LHA/.test(normalizedHull)) return 'amphibious assault ship';
  if (/^LPD/.test(normalizedHull)) return 'amphibious transport dock';
  if (/^LSD/.test(normalizedHull)) return 'dock landing ship';
  if (/^DDG/.test(normalizedHull)) return 'guided-missile destroyer';
  if (/^CG/.test(normalizedHull)) return 'guided-missile cruiser';
  if (/^LCS/.test(normalizedHull)) return 'littoral combat ship';
  if (/^SSN/.test(normalizedHull) || /^SSGN/.test(normalizedHull) || /^SSBN/.test(normalizedHull)) return 'submarine';
  if (/^LCC/.test(normalizedHull)) return 'command ship';
  if (/^WAGB/.test(normalizedHull)) return 'icebreaker';
  if (/^T-?AO/.test(normalizedHull) || /^T-?AKE/.test(normalizedHull) || /^T-?EPF/.test(normalizedHull)) return 'auxiliary';
  const sentenceLower = sentence.toLowerCase();
  if (sentenceLower.includes('carrier')) return 'aircraft carrier';
  if (sentenceLower.includes('destroyer')) return 'guided-missile destroyer';
  if (sentenceLower.includes('cruiser')) return 'guided-missile cruiser';
  if (sentenceLower.includes('amphibious')) return 'amphibious warship';
  return 'surface combatant';
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const q = (sinLat ** 2) + (Math.cos(lat1) * Math.cos(lat2) * (sinLon ** 2));
  return 2 * r * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function getLocationReference(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return null;
  for (const location of LOCATION_REFERENCES) {
    if (location.patterns.some((pattern) => pattern.test(normalized))) {
      return location;
    }
  }
  return null;
}

function splitSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
}

function collectMentionsFromSentence(sentence, location, item, mentions) {
  if (!location) return;
  for (const match of sentence.matchAll(SHIP_REGEX)) {
    const prefix = match[1];
    const shipName = normalizeShipName(match[2]);
    const hull = normalizeWhitespace(match[3]);
    const vesselKey = `${prefix} ${shipName} (${hull})`;
    const mentionKey = `${item.id}:${vesselKey}`;
    const existing = mentions.get(mentionKey);
    const next = {
      vesselKey,
      vesselPrefix: prefix,
      vesselName: shipName,
      hullNumber: hull,
      vesselType: inferVesselType(hull, sentence),
      publishedAt: item.publishedAt,
      reportDate: item.publishedAt ? item.publishedAt.slice(0, 10) : null,
      sourceItemId: item.id,
      sourceKind: item.sourceKind,
      sourceTitle: item.title,
      sourceUrl: item.url,
      searchTerm: item.searchTerm || null,
      searchTerms: item.searchTerms || (item.searchTerm ? [item.searchTerm] : []),
      positionId: location.id,
      positionLabel: location.label,
      positionLat: location.lat,
      positionLon: location.lon,
      inCombatZone: Boolean(location.combatZone),
      comments: sentence,
      mapImageLocalUrl: item.mapImageLocalUrl || null,
      mapImageRemoteUrl: item.mapImageRemoteUrl || null,
    };
    if (!existing || (existing.positionId === location.id && sentence.length > existing.comments.length)) {
      mentions.set(mentionKey, next);
    }
  }
}

function extractTrackerMentions(item) {
  const mentions = new Map();
  for (const section of item.sections || []) {
    const sectionLocation = getLocationReference(section.heading);
    if (!sectionLocation) continue;
    for (const sentence of splitSentences(section.bodyText)) {
      const sentenceLocation = getLocationReference(sentence) || sectionLocation;
      collectMentionsFromSentence(sentence, sentenceLocation, item, mentions);
    }
  }
  return [...mentions.values()];
}

function extractNewsMentions(item) {
  const mentions = new Map();
  const fragments = [
    item.title,
    item.excerpt,
    ...(item.contentText || '').split('\n'),
  ].map((value) => normalizeWhitespace(value)).filter(Boolean);
  for (const fragment of fragments) {
    const location = getLocationReference(fragment);
    if (!location) continue;
    for (const sentence of splitSentences(fragment)) {
      const sentenceLocation = getLocationReference(sentence) || location;
      collectMentionsFromSentence(sentence, sentenceLocation, item, mentions);
    }
  }
  return [...mentions.values()];
}

function buildMovementRow(previous, current) {
  const previousDistanceKm = haversineKm({ lat: previous.positionLat, lon: previous.positionLon }, COMBAT_REFERENCE);
  const currentDistanceKm = haversineKm({ lat: current.positionLat, lon: current.positionLon }, COMBAT_REFERENCE);
  const combatRelevant = previous.inCombatZone
    || current.inCombatZone
    || previousDistanceKm < 9000
    || currentDistanceKm < 9000;
  let direction = 'repositioned';
  if (!previous.inCombatZone && current.inCombatZone) direction = 'entered_combat_zone';
  else if (previous.inCombatZone && !current.inCombatZone) direction = 'exited_combat_zone';
  else if (combatRelevant && currentDistanceKm + 750 < previousDistanceKm) direction = 'toward_arabian_sea';
  else if (combatRelevant && currentDistanceKm > previousDistanceKm + 750) direction = 'away_from_arabian_sea';
  else if (current.positionId === previous.positionId) direction = 'unchanged';

  return {
    vesselKey: current.vesselKey,
    vesselName: current.vesselName,
    vesselType: current.vesselType,
    date: current.reportDate,
    previousPosition: previous.positionLabel,
    previousCoordinates: {
      lat: previous.positionLat,
      lon: previous.positionLon,
    },
    currentPosition: current.positionLabel,
    currentCoordinates: {
      lat: current.positionLat,
      lon: current.positionLon,
    },
    direction,
    comments: `${previous.sourceTitle} -> ${current.sourceTitle}. ${current.comments}`.trim(),
    previousSourceUrl: previous.sourceUrl,
    currentSourceUrl: current.sourceUrl,
    previousMapImageLocalUrl: previous.mapImageLocalUrl,
    currentMapImageLocalUrl: current.mapImageLocalUrl,
    previousMapImageRemoteUrl: previous.mapImageRemoteUrl,
    currentMapImageRemoteUrl: current.mapImageRemoteUrl,
    distanceToArabianSeaKm: {
      previous: Math.round(previousDistanceKm),
      current: Math.round(currentDistanceKm),
    },
  };
}

export function buildUsniFleetArtifacts({ history, latestRun }) {
  const generatedAt = new Date().toISOString();
  const items = [...(history.items || [])]
    .sort((a, b) => +new Date(a.publishedAt || 0) - +new Date(b.publishedAt || 0));

  const mentions = items.flatMap((item) => (item.sourceKind === 'fleet_tracker'
    ? extractTrackerMentions(item)
    : extractNewsMentions(item)));

  const mentionsByVessel = new Map();
  for (const mention of mentions) {
    if (!mentionsByVessel.has(mention.vesselKey)) mentionsByVessel.set(mention.vesselKey, []);
    mentionsByVessel.get(mention.vesselKey).push(mention);
  }

  const vesselHistory = [...mentionsByVessel.entries()]
    .map(([vesselKey, vesselMentions]) => {
      const positions = vesselMentions
        .sort((a, b) => +new Date(a.publishedAt || 0) - +new Date(b.publishedAt || 0));
      const latestPosition = positions[positions.length - 1] || null;
      return {
        vesselKey,
        vesselName: latestPosition?.vesselName || null,
        vesselType: latestPosition?.vesselType || null,
        hullNumber: latestPosition?.hullNumber || null,
        latestPosition: latestPosition ? {
          date: latestPosition.reportDate,
          position: latestPosition.positionLabel,
          coordinates: {
            lat: latestPosition.positionLat,
            lon: latestPosition.positionLon,
          },
          sourceUrl: latestPosition.sourceUrl,
        } : null,
        positions,
      };
    })
    .sort((a, b) => a.vesselName.localeCompare(b.vesselName));

  const movementRows = [];
  for (const vessel of vesselHistory) {
    for (let index = 1; index < vessel.positions.length; index += 1) {
      const previous = vessel.positions[index - 1];
      const current = vessel.positions[index];
      if (!previous || !current) continue;
      if (previous.positionId === current.positionId && previous.reportDate === current.reportDate) continue;
      movementRows.push(buildMovementRow(previous, current));
    }
  }

  const trackerSnapshots = items
    .filter((item) => item.sourceKind === 'fleet_tracker')
    .map((item) => ({
      id: item.id,
      date: item.publishedAt ? item.publishedAt.slice(0, 10) : null,
      title: item.title,
      url: item.url,
      mapImageLocalUrl: item.mapImageLocalUrl || null,
      mapImageRemoteUrl: item.mapImageRemoteUrl || null,
      vessels: mentions.filter((mention) => mention.sourceItemId === item.id),
    }))
    .sort((a, b) => +new Date(a.date || 0) - +new Date(b.date || 0));

  const relevantMovements = movementRows
    .filter((row) => ['entered_combat_zone', 'exited_combat_zone', 'toward_arabian_sea', 'away_from_arabian_sea'].includes(row.direction))
    .sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0));

  const artifactItems = [...history.items || []]
    .sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0))
    .map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      sourceKind: item.sourceKind,
      searchTerms: item.searchTerms || (item.searchTerm ? [item.searchTerm] : []),
      mapImageLocalUrl: item.mapImageLocalUrl || null,
      mapImageRemoteUrl: item.mapImageRemoteUrl || null,
      categories: item.categories || [],
      sectionHeadings: (item.sections || []).map((section) => section.heading).filter(Boolean),
    }));

  return {
    metadata: {
      generatedAt,
      profile: 'usni-fleet-tracker',
      sourceUrl: latestRun.sourceUrl,
      sourceApiUrl: latestRun.sourceApiUrl,
      itemCount: artifactItems.length,
      trackerItemCount: artifactItems.filter((item) => item.sourceKind === 'fleet_tracker').length,
      newsItemCount: artifactItems.filter((item) => item.sourceKind === 'news').length,
      vesselCount: vesselHistory.length,
      movementCount: movementRows.length,
      relevantMovementCount: relevantMovements.length,
      trackerSnapshotCount: trackerSnapshots.length,
      latestPublishedAt: latestRun.latestPublishedAt || artifactItems[0]?.publishedAt || null,
      lastRunAt: latestRun.runAt,
      combatReference: COMBAT_REFERENCE,
    },
    items: artifactItems,
    relevantMovements,
    movementRows,
    vesselHistory,
    trackerSnapshots,
  };
}
