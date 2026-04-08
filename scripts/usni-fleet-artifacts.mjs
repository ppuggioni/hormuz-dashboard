const COMBAT_REFERENCE = {
  label: 'Arabian Sea',
  lat: 17.5,
  lon: 65.5,
};

const LOCATION_REFERENCES = [
  { id: 'split_croatia', label: 'Split, Croatia', lat: 43.51, lon: 16.44, combatZone: false, patterns: [/\bsplit,\s*croatia\b/i, /\bsplit\b/i] },
  { id: 'souda_bay', label: 'Souda Bay, Greece', lat: 35.49, lon: 24.07, combatZone: false, patterns: [/\bsouda bay\b/i] },
  { id: 'eastern_mediterranean', label: 'Eastern Mediterranean Sea', lat: 34.5, lon: 28.0, combatZone: false, patterns: [/\beastern mediterranean(?: sea)?\b/i] },
  { id: 'mediterranean_sea', label: 'Mediterranean Sea', lat: 35.8, lon: 18.0, combatZone: false, patterns: [/\bmediterranean sea\b/i, /\bmediterranean\b/i] },
  { id: 'arabian_sea', label: 'Arabian Sea', lat: 17.5, lon: 65.5, combatZone: true, patterns: [/\barabian sea\b/i] },
  { id: 'gulf_of_oman', label: 'Gulf of Oman', lat: 24.5, lon: 59.8, combatZone: true, patterns: [/\bgulf of oman\b/i] },
  { id: 'gulf_of_aden', label: 'Gulf of Aden', lat: 13.0, lon: 48.0, combatZone: true, patterns: [/\bgulf of aden\b/i] },
  { id: 'red_sea', label: 'Red Sea', lat: 20.0, lon: 39.0, combatZone: true, patterns: [/\bred sea\b/i] },
  { id: 'persian_gulf', label: 'Persian Gulf', lat: 26.5, lon: 52.5, combatZone: true, patterns: [/\bpersian gulf\b/i, /\barabian gulf\b/i] },
  { id: 'diego_garcia', label: 'Diego Garcia', lat: -7.31, lon: 72.41, combatZone: false, patterns: [/\bdiego garcia\b/i] },
  { id: 'strait_of_gibraltar', label: 'Strait of Gibraltar', lat: 36.0, lon: -5.5, combatZone: false, patterns: [/\bstrait of gibraltar\b/i, /\bgibraltar\b/i] },
  { id: 'mayport', label: 'Mayport, Florida', lat: 30.39, lon: -81.43, combatZone: false, patterns: [/\bmayport\b/i, /\bmayport,\s*fla\b/i] },
  { id: 'norfolk', label: 'Norfolk, Virginia', lat: 36.95, lon: -76.33, combatZone: false, patterns: [/\bnorfolk\b/i, /\bnaval station norfolk\b/i] },
  { id: 'chesapeake_bay', label: 'Chesapeake Bay', lat: 37.5, lon: -76.1, combatZone: false, patterns: [/\bchesapeake bay\b/i] },
  { id: 'ponce', label: 'Ponce, Puerto Rico', lat: 17.97, lon: -66.61, combatZone: false, patterns: [/\bponce,\s*puerto rico\b/i, /\bponce\b/i] },
  { id: 'caribbean_sea', label: 'Caribbean Sea', lat: 16.5, lon: -74.0, combatZone: false, patterns: [/\bcaribbean sea\b/i] },
  { id: 'western_atlantic', label: 'Western Atlantic', lat: 31.0, lon: -62.0, combatZone: false, patterns: [/\bwestern atlantic\b/i] },
  { id: 'eastern_atlantic', label: 'Eastern Atlantic', lat: 33.0, lon: -20.0, combatZone: false, patterns: [/\beastern atlantic\b/i] },
  { id: 'atlantic_ocean', label: 'Atlantic Ocean', lat: 31.0, lon: -42.0, combatZone: false, patterns: [/\batlantic\b/i] },
  { id: 'pearl_harbor', label: 'Pearl Harbor, Hawaii', lat: 21.36, lon: -157.95, combatZone: false, patterns: [/\bpearl harbor\b/i, /\bpearl harbor,\s*hawaii\b/i] },
  { id: 'hawaii', label: 'Hawaii', lat: 21.3, lon: -157.8, combatZone: false, patterns: [/\bhawaii\b/i] },
  { id: 'san_diego', label: 'San Diego, California', lat: 32.72, lon: -117.17, combatZone: false, patterns: [/\bsan diego\b/i] },
  { id: 'panama_city', label: 'Panama City, Panama', lat: 8.98, lon: -79.52, combatZone: false, patterns: [/\bpanama city,\s*panama\b/i, /\bpanama city\b/i] },
  { id: 'eastern_pacific', label: 'Eastern Pacific', lat: 14.0, lon: -110.0, combatZone: false, patterns: [/\beastern pacific\b/i] },
  { id: 'pacific_ocean', label: 'Pacific Ocean', lat: 18.0, lon: -155.0, combatZone: false, patterns: [/\bpacific ocean\b/i, /\bin the pacific\b/i, /\bwestern pacific\b/i, /\bpacific\b/i] },
  { id: 'philippine_sea', label: 'Philippine Sea', lat: 18.0, lon: 132.0, combatZone: false, patterns: [/\bphilippine sea\b/i] },
  { id: 'south_china_sea', label: 'South China Sea', lat: 14.0, lon: 113.0, combatZone: false, patterns: [/\bsouth china sea\b/i] },
  { id: 'manila', label: 'Manila, Philippines', lat: 14.6, lon: 120.98, combatZone: false, patterns: [/\bmanila\b/i] },
  { id: 'okinawa', label: 'Okinawa, Japan', lat: 26.21, lon: 127.68, combatZone: false, patterns: [/\bokinawa,\s*japan\b/i, /\bokinawa\b/i] },
  { id: 'yokosuka', label: 'Yokosuka, Japan', lat: 35.28, lon: 139.67, combatZone: false, patterns: [/\byokosuka,\s*japan\b/i, /\byokosuka\b/i] },
  { id: 'japan', label: 'Japan', lat: 35.7, lon: 139.7, combatZone: false, patterns: [/\bin japan\b/i, /\bjapan\b/i] },
  { id: 'wellington', label: 'Wellington, New Zealand', lat: -41.29, lon: 174.78, combatZone: false, patterns: [/\bwellington,\s*new zealand\b/i, /\bwellington\b/i] },
  { id: 'new_zealand', label: 'New Zealand', lat: -41.0, lon: 174.0, combatZone: false, patterns: [/\bnew zealand\b/i] },
  { id: 'croatia', label: 'Croatia', lat: 43.5, lon: 16.0, combatZone: false, patterns: [/\bcroatia\b/i] },
];

const SHIP_REGEX = /\b(USS|USNS|USCGC)\s+([A-Z0-9][A-Za-z0-9.'’\-\s]+?)\s*\(([A-Z0-9\- ]{2,20})\)/g;
const GROUP_ALIAS_REGEX = /(?:USS\s+)?([A-Z0-9][A-Za-z0-9.'’\-\s]+?)\s+(CSG|ARG)\b/g;
const MAP_NOISE_PATTERNS = [/^USNI News$/i];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeShipName(value) {
  return normalizeWhitespace(String(value || '').replace(/\s+/g, ' '));
}

function normalizeNameKey(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .toLowerCase());
}

function normalizeOcrText(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/^[•\-.:\s]+/, '')
    .replace(/^•/, '')
    .replace(/\s*•\s*/g, ' ')
    .replace(/\bUSS(?=[A-Z])/g, 'USS ')
    .replace(/\s+/g, ' '));
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

function nearestLocationReference({ lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const location of LOCATION_REFERENCES) {
    const distanceKm = haversineKm({ lat, lon }, location);
    if (!best || distanceKm < best.distanceKm) {
      best = { location, distanceKm };
    }
  }
  return best;
}

function splitSentences(text) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
}

function shouldTreatSentenceLocationAsHomeport(sentence, sectionLocation, sentenceLocation) {
  if (!sectionLocation || !sentenceLocation) return false;
  if (sectionLocation.id === sentenceLocation.id) return false;
  const normalized = normalizeWhitespace(sentence).toLowerCase();
  return normalized.includes('homeported');
}

function buildMention({
  vesselKey,
  vesselPrefix,
  vesselName,
  hullNumber,
  vesselType,
  item,
  location,
  comments,
  sourceKind = item.sourceKind,
  positionLat,
  positionLon,
  inCombatZone = Boolean(location?.combatZone),
  positionId = location?.id || null,
  positionLabel = location?.label || null,
  positionSourceType = 'text',
  locationSourceType = 'explicit_sentence',
  imageLabel = null,
}) {
  if (!positionLabel || !Number.isFinite(positionLat) || !Number.isFinite(positionLon)) return null;
  return {
    vesselKey,
    vesselPrefix,
    vesselName,
    hullNumber,
    vesselType,
    publishedAt: item.publishedAt,
    reportDate: item.publishedAt ? item.publishedAt.slice(0, 10) : null,
    sourceItemId: item.id,
    sourceKind,
    sourceTitle: item.title,
    sourceUrl: item.url,
    searchTerm: item.searchTerm || null,
    searchTerms: item.searchTerms || (item.searchTerm ? [item.searchTerm] : []),
    positionId,
    positionLabel,
    positionLat,
    positionLon,
    inCombatZone,
    comments,
    mapImageLocalUrl: item.mapImageLocalUrl || null,
    mapImageRemoteUrl: item.mapImageRemoteUrl || null,
    positionSourceType,
    locationSourceType,
    imageLabel,
    evidenceSources: [positionSourceType === 'image' ? 'image' : 'text'],
  };
}

function collectMentionsFromSentence(sentence, location, item, mentions, {
  locationSourceType = 'explicit_sentence',
} = {}) {
  if (!location) return;
  for (const match of sentence.matchAll(SHIP_REGEX)) {
    const prefix = match[1];
    const shipName = normalizeShipName(match[2]);
    const hull = normalizeWhitespace(match[3]);
    const vesselKey = `${prefix} ${shipName} (${hull})`;
    const mentionKey = `${item.id}:${vesselKey}`;
    const next = buildMention({
      vesselKey,
      vesselPrefix: prefix,
      vesselName: shipName,
      hullNumber: hull,
      vesselType: inferVesselType(hull, sentence),
      item,
      location,
      comments: sentence,
      positionLat: location.lat,
      positionLon: location.lon,
      positionSourceType: 'text',
      locationSourceType,
    });
    if (!next) continue;
    const existing = mentions.get(mentionKey);
    if (!existing || (existing.positionId === location.id && sentence.length > existing.comments.length)) {
      mentions.set(mentionKey, next);
    }
  }
}

function extractNamedShipsFromItem(item) {
  const ships = new Map();
  const fragments = [
    item.title,
    item.excerpt,
    item.contentText,
    ...(item.sections || []).map((section) => section.bodyText),
  ]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);

  for (const fragment of fragments) {
    for (const match of fragment.matchAll(SHIP_REGEX)) {
      const vesselPrefix = match[1];
      const vesselName = normalizeShipName(match[2]);
      const hullNumber = normalizeWhitespace(match[3]);
      const vesselKey = `${vesselPrefix} ${vesselName} (${hullNumber})`;
      if (!ships.has(vesselKey)) {
        ships.set(vesselKey, {
          vesselKey,
          vesselPrefix,
          vesselName,
          hullNumber,
          vesselType: inferVesselType(hullNumber, fragment),
        });
      }
    }
  }

  return [...ships.values()];
}

function extractTrackerMentions(item) {
  const mentions = new Map();
  let activeLocation = null;
  for (const section of item.sections || []) {
    const headingLocation = getLocationReference(section.heading);
    if (headingLocation) activeLocation = headingLocation;
    const sectionLocation = headingLocation || activeLocation;
    for (const sentence of splitSentences(section.bodyText)) {
      const rawSentenceLocation = getLocationReference(sentence);
      const sentenceLocation = shouldTreatSentenceLocationAsHomeport(sentence, sectionLocation, rawSentenceLocation)
        ? null
        : rawSentenceLocation;
      const effectiveLocation = sentenceLocation || sectionLocation;
      const locationSourceType = sentenceLocation
        ? 'explicit_sentence'
        : headingLocation
          ? 'section_heading'
          : effectiveLocation
            ? 'inherited_section'
            : 'unknown';
      collectMentionsFromSentence(sentence, effectiveLocation, item, mentions, { locationSourceType });
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
      const locationSourceType = getLocationReference(sentence) ? 'explicit_sentence' : 'fragment_context';
      collectMentionsFromSentence(sentence, sentenceLocation, item, mentions, { locationSourceType });
    }
  }
  return [...mentions.values()];
}

function buildOcrBlocks(lines) {
  const cleanedLines = (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const text = normalizeOcrText(line?.text || '');
      if (!text || MAP_NOISE_PATTERNS.some((pattern) => pattern.test(text))) return null;
      const x = Number(line.x);
      const y = Number(line.y);
      const width = Number(line.width);
      const height = Number(line.height);
      if (![x, y, width, height].every(Number.isFinite)) return null;
      return {
        text,
        x,
        y,
        width,
        height,
        centerX: x + (width / 2),
        centerY: y + (height / 2),
      };
    })
    .filter(Boolean);

  const blocks = [];
  for (const line of cleanedLines.sort((a, b) => a.centerX - b.centerX || b.centerY - a.centerY)) {
    let bestBlock = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const block of blocks) {
      const xDelta = Math.abs(block.centerX - line.centerX);
      const yDelta = Math.min(...block.lines.map((existingLine) => Math.abs(existingLine.centerY - line.centerY)));
      if (xDelta > 0.04 || yDelta > 0.045) continue;
      const score = (xDelta * 2) + yDelta;
      if (score < bestScore) {
        bestScore = score;
        bestBlock = block;
      }
    }
    if (!bestBlock) {
      blocks.push({
        lines: [line],
        centerX: line.centerX,
        centerY: line.centerY,
      });
      continue;
    }
    bestBlock.lines.push(line);
    bestBlock.centerX = bestBlock.lines.reduce((sum, entry) => sum + entry.centerX, 0) / bestBlock.lines.length;
    bestBlock.centerY = bestBlock.lines.reduce((sum, entry) => sum + entry.centerY, 0) / bestBlock.lines.length;
  }

  return blocks
    .map((block) => {
      const sortedLines = [...block.lines].sort((a, b) => b.centerY - a.centerY);
      return {
        ...block,
        lines: sortedLines,
        text: sortedLines.map((line) => line.text).join('\n'),
        location: getLocationReference(sortedLines.map((line) => line.text).join(' ')),
      };
    })
    .sort((a, b) => b.centerY - a.centerY || a.centerX - b.centerX);
}

function resolveAliasToShip(alias, ships) {
  if (!alias?.label || !Array.isArray(ships) || !ships.length) return null;
  if (alias.kind === 'direct' && alias.hullNumber) {
    const directMatch = ships.find((ship) => ship.hullNumber === alias.hullNumber);
    if (directMatch) return directMatch;
  }

  const aliasKey = normalizeNameKey(alias.baseName || alias.label);
  if (!aliasKey) return null;
  const aliasTokens = aliasKey.split(' ').filter(Boolean);
  let best = null;

  for (const ship of ships) {
    const shipKey = normalizeNameKey(ship.vesselName);
    const shipTokens = shipKey.split(' ').filter(Boolean);
    let score = 0;
    if (shipKey === aliasKey) score += 100;
    if (shipKey.includes(aliasKey)) score += 70;
    score += aliasTokens.filter((token) => shipTokens.includes(token)).length * 15;
    score -= Math.abs(shipTokens.length - aliasTokens.length) * 2;
    if (alias.groupKind === 'CSG' && ship.vesselType === 'aircraft carrier') score += 25;
    if (alias.groupKind === 'ARG' && ship.vesselType.includes('amphibious')) score += 25;
    if (!best || score > best.score) best = { ship, score };
  }

  return best && best.score >= 12 ? best.ship : null;
}

function extractAliasesFromBlock(block, ships) {
  const aliases = [];
  const seen = new Set();
  for (const line of block.lines) {
    const lineText = line.text;
    for (const match of lineText.matchAll(SHIP_REGEX)) {
      const vesselPrefix = match[1];
      const vesselName = normalizeShipName(match[2]);
      const hullNumber = normalizeWhitespace(match[3]);
      const vesselKey = `${vesselPrefix} ${vesselName} (${hullNumber})`;
      if (seen.has(`direct:${vesselKey}`)) continue;
      aliases.push({
        kind: 'direct',
        label: `${vesselPrefix} ${vesselName} (${hullNumber})`,
        baseName: vesselName,
        hullNumber,
        line,
        ship: resolveAliasToShip({ kind: 'direct', label: vesselName, baseName: vesselName, hullNumber }, ships),
      });
      seen.add(`direct:${vesselKey}`);
    }
    for (const match of lineText.matchAll(GROUP_ALIAS_REGEX)) {
      const baseName = normalizeShipName(match[1]);
      const groupKind = normalizeWhitespace(match[2]).toUpperCase();
      const label = `${baseName} ${groupKind}`;
      if (seen.has(`group:${label}`)) continue;
      aliases.push({
        kind: 'group',
        label,
        baseName,
        groupKind,
        line,
        ship: resolveAliasToShip({ kind: 'group', label, baseName, groupKind }, ships),
      });
      seen.add(`group:${label}`);
    }
  }
  return aliases.filter((alias) => alias.ship);
}

function solveLinearSystem3(matrix, vector) {
  const a = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);
  for (let pivotIndex = 0; pivotIndex < 3; pivotIndex += 1) {
    let maxRow = pivotIndex;
    for (let row = pivotIndex + 1; row < 3; row += 1) {
      if (Math.abs(a[row][pivotIndex]) > Math.abs(a[maxRow][pivotIndex])) maxRow = row;
    }
    if (Math.abs(a[maxRow][pivotIndex]) < 1e-9) return null;
    if (maxRow !== pivotIndex) {
      [a[pivotIndex], a[maxRow]] = [a[maxRow], a[pivotIndex]];
    }
    const pivot = a[pivotIndex][pivotIndex];
    for (let column = pivotIndex; column < 4; column += 1) {
      a[pivotIndex][column] /= pivot;
    }
    for (let row = 0; row < 3; row += 1) {
      if (row === pivotIndex) continue;
      const factor = a[row][pivotIndex];
      for (let column = pivotIndex; column < 4; column += 1) {
        a[row][column] -= factor * a[pivotIndex][column];
      }
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function fitAffineAxis(samples, key) {
  if (!samples.length) return null;
  let sumXX = 0;
  let sumXY = 0;
  let sumX1 = 0;
  let sumYY = 0;
  let sumY1 = 0;
  let sum11 = samples.length;
  let sumXT = 0;
  let sumYT = 0;
  let sum1T = 0;

  for (const sample of samples) {
    const x = sample.x;
    const y = sample.y;
    const target = sample[key];
    sumXX += x * x;
    sumXY += x * y;
    sumX1 += x;
    sumYY += y * y;
    sumY1 += y;
    sumXT += x * target;
    sumYT += y * target;
    sum1T += target;
  }

  return solveLinearSystem3([
    [sumXX, sumXY, sumX1],
    [sumXY, sumYY, sumY1],
    [sumX1, sumY1, sum11],
  ], [sumXT, sumYT, sum1T]);
}

function fitAffineTransform(samples) {
  if (!Array.isArray(samples) || samples.length < 3) return null;
  const lonCoefficients = fitAffineAxis(samples, 'lon');
  const latCoefficients = fitAffineAxis(samples, 'lat');
  if (!lonCoefficients || !latCoefficients) return null;
  const [lonA, lonB, lonC] = lonCoefficients;
  const [latA, latB, latC] = latCoefficients;
  const residuals = samples.map((sample) => {
    const lon = (lonA * sample.x) + (lonB * sample.y) + lonC;
    const lat = (latA * sample.x) + (latB * sample.y) + latC;
    return haversineKm({ lat, lon }, { lat: sample.lat, lon: sample.lon });
  });
  const rmsErrorKm = residuals.length
    ? Math.sqrt(residuals.reduce((sum, value) => sum + (value ** 2), 0) / residuals.length)
    : null;
  return {
    lon: { a: lonA, b: lonB, c: lonC },
    lat: { a: latA, b: latB, c: latC },
    trainingPairCount: samples.length,
    rmsErrorKm,
  };
}

function applyAffineTransform(transform, centerX, centerY) {
  if (!transform) return null;
  const lon = (transform.lon.a * centerX) + (transform.lon.b * centerY) + transform.lon.c;
  const lat = (transform.lat.a * centerX) + (transform.lat.b * centerY) + transform.lat.c;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function buildImageMentions({
  trackerItems,
  mapExtractions,
  textMentionsByItemAndVessel,
  namedShipsByItem,
  transform,
}) {
  const imageMentions = [];
  for (const item of trackerItems) {
    const extractionItem = mapExtractions?.items?.[item.id];
    if (!extractionItem?.lines?.length) continue;
    const blocks = buildOcrBlocks(extractionItem.lines);
    const ships = namedShipsByItem.get(item.id) || [];
    for (const block of blocks) {
      const blockLocation = block.location;
      const aliases = extractAliasesFromBlock(block, ships);
      for (const alias of aliases) {
        const existingTextMention = textMentionsByItemAndVessel.get(`${item.id}:${alias.ship.vesselKey}`) || null;
        const imageCoordinates = applyAffineTransform(transform, alias.line.centerX, alias.line.centerY);
        const nearestLocation = imageCoordinates ? nearestLocationReference(imageCoordinates) : null;
        const explicitLocation = blockLocation;
        const fallbackLabel = explicitLocation?.label
          || existingTextMention?.positionLabel
          || (nearestLocation && nearestLocation.distanceKm <= 2400 ? nearestLocation.location.label : null);
        const fallbackPositionId = explicitLocation?.id
          || existingTextMention?.positionId
          || (nearestLocation && nearestLocation.distanceKm <= 2400 ? nearestLocation.location.id : null);
        const fallbackCombatZone = explicitLocation?.combatZone
          ?? existingTextMention?.inCombatZone
          ?? (nearestLocation && nearestLocation.distanceKm <= 2400 ? nearestLocation.location.combatZone : false);
        const positionLat = explicitLocation?.lat
          ?? existingTextMention?.positionLat
          ?? (nearestLocation && nearestLocation.distanceKm <= 2400 ? nearestLocation.location.lat : null)
          ?? imageCoordinates?.lat
          ?? null;
        const positionLon = explicitLocation?.lon
          ?? existingTextMention?.positionLon
          ?? (nearestLocation && nearestLocation.distanceKm <= 2400 ? nearestLocation.location.lon : null)
          ?? imageCoordinates?.lon
          ?? null;
        const mention = buildMention({
          vesselKey: alias.ship.vesselKey,
          vesselPrefix: alias.ship.vesselPrefix,
          vesselName: alias.ship.vesselName,
          hullNumber: alias.ship.hullNumber,
          vesselType: alias.ship.vesselType,
          item,
          location: explicitLocation || (nearestLocation && nearestLocation.distanceKm <= 2400 ? nearestLocation.location : null),
          comments: `Map label: ${block.text.replace(/\n+/g, ' / ')}`,
          sourceKind: 'fleet_tracker',
          positionLat,
          positionLon,
          positionId: fallbackPositionId,
          positionLabel: fallbackLabel,
          inCombatZone: fallbackCombatZone,
          positionSourceType: explicitLocation ? 'image' : (existingTextMention ? 'text' : 'image'),
          locationSourceType: explicitLocation ? 'image_text' : existingTextMention ? existingTextMention.locationSourceType : 'image_affine',
          imageLabel: block.text,
        });
        if (mention) imageMentions.push(mention);
      }
    }
  }
  return imageMentions;
}

function mergeMentions(textMentions, imageMentions) {
  const merged = new Map();
  for (const mention of textMentions) {
    merged.set(`${mention.sourceItemId}:${mention.vesselKey}`, { ...mention, evidenceSources: ['text'] });
  }
  for (const imageMention of imageMentions) {
    const key = `${imageMention.sourceItemId}:${imageMention.vesselKey}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...imageMention, evidenceSources: ['image'] });
      continue;
    }
    const imageHasExplicitLabel = imageMention.locationSourceType === 'image_text';
    const mergedComments = [existing.comments, imageMention.imageLabel ? `Map label: ${imageMention.imageLabel.replace(/\n+/g, ' / ')}` : null]
      .filter(Boolean)
      .join(' ');
    merged.set(key, {
      ...existing,
      positionLat: imageHasExplicitLabel && Number.isFinite(imageMention.positionLat) ? imageMention.positionLat : existing.positionLat,
      positionLon: imageHasExplicitLabel && Number.isFinite(imageMention.positionLon) ? imageMention.positionLon : existing.positionLon,
      positionId: imageHasExplicitLabel ? imageMention.positionId : (existing.positionId || imageMention.positionId),
      positionLabel: imageHasExplicitLabel ? imageMention.positionLabel : (existing.positionLabel || imageMention.positionLabel),
      inCombatZone: imageHasExplicitLabel ? imageMention.inCombatZone : (existing.inCombatZone || imageMention.inCombatZone),
      comments: mergedComments || existing.comments,
      mapImageLocalUrl: existing.mapImageLocalUrl || imageMention.mapImageLocalUrl,
      mapImageRemoteUrl: existing.mapImageRemoteUrl || imageMention.mapImageRemoteUrl,
      imageLabel: imageMention.imageLabel || existing.imageLabel || null,
      positionSourceType: imageMention.positionSourceType || existing.positionSourceType,
      locationSourceType: imageHasExplicitLabel ? imageMention.locationSourceType : existing.locationSourceType,
      evidenceSources: [...new Set([...(existing.evidenceSources || []), 'image'])],
    });
  }
  return [...merged.values()];
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

export function buildUsniFleetArtifacts({ history, latestRun, mapExtractions }) {
  const generatedAt = new Date().toISOString();
  const items = [...(history.items || [])]
    .sort((a, b) => +new Date(a.publishedAt || 0) - +new Date(b.publishedAt || 0));
  const trackerItems = items.filter((item) => item.sourceKind === 'fleet_tracker');

  const namedShipsByItem = new Map(trackerItems.map((item) => [item.id, extractNamedShipsFromItem(item)]));
  const textMentions = items.flatMap((item) => (item.sourceKind === 'fleet_tracker'
    ? extractTrackerMentions(item)
    : extractNewsMentions(item)));
  const textMentionsByItemAndVessel = new Map(textMentions.map((mention) => [`${mention.sourceItemId}:${mention.vesselKey}`, mention]));

  const trainingPairs = [];
  for (const item of trackerItems) {
    const extractionItem = mapExtractions?.items?.[item.id];
    if (!extractionItem?.lines?.length) continue;
    const blocks = buildOcrBlocks(extractionItem.lines);
    const ships = namedShipsByItem.get(item.id) || [];
    for (const block of blocks) {
      for (const alias of extractAliasesFromBlock(block, ships)) {
        const textMention = textMentionsByItemAndVessel.get(`${item.id}:${alias.ship.vesselKey}`);
        if (!textMention) continue;
        trainingPairs.push({
          x: alias.line.centerX,
          y: alias.line.centerY,
          lat: textMention.positionLat,
          lon: textMention.positionLon,
        });
      }
    }
  }

  const mapTransform = fitAffineTransform(trainingPairs);
  const imageMentions = buildImageMentions({
    trackerItems,
    mapExtractions,
    textMentionsByItemAndVessel,
    namedShipsByItem,
    transform: mapTransform,
  });
  const mentions = mergeMentions(textMentions, imageMentions);

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
          evidenceSources: latestPosition.evidenceSources || [],
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
      const row = buildMovementRow(previous, current);
      const displacementKm = haversineKm(row.previousCoordinates, row.currentCoordinates);
      if (row.direction === 'unchanged' && displacementKm < 250) continue;
      movementRows.push(row);
    }
  }

  movementRows.sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0));

  const trackerSnapshots = trackerItems
    .map((item) => ({
      id: item.id,
      date: item.publishedAt ? item.publishedAt.slice(0, 10) : null,
      title: item.title,
      url: item.url,
      mapImageLocalUrl: item.mapImageLocalUrl || null,
      mapImageRemoteUrl: item.mapImageRemoteUrl || null,
      vessels: mentions
        .filter((mention) => mention.sourceItemId === item.id)
        .sort((a, b) => a.vesselName.localeCompare(b.vesselName)),
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
      mapExtractionCount: Object.keys(mapExtractions?.items || {}).length,
      imageDerivedMentionCount: imageMentions.length,
      mapTransform: mapTransform ? {
        trainingPairCount: mapTransform.trainingPairCount,
        rmsErrorKm: mapTransform.rmsErrorKm != null ? Math.round(mapTransform.rmsErrorKm) : null,
      } : null,
    },
    items: artifactItems,
    relevantMovements,
    movementRows,
    vesselHistory,
    trackerSnapshots,
  };
}
