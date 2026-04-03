export const RED_SEA_CROSSING_ZONE_ORDER = [
  'rs-south-out',
  'rs-south-in',
  'rs-north-in',
  'rs-north-out',
];

export const RED_SEA_TRANSPONDER_GATES = {
  south_bab_el_mandeb: {
    label: 'south_bab_el_mandeb',
    displayName: 'Bab el-Mandeb',
    minLon: 42.7,
    maxLon: 43.9,
    minLat: 11.8,
    maxLat: 13.6,
    centerLat: 12.58,
    centerLon: 43.33,
    splitAxis: 'lon',
    splitValue: 43.33,
    negativeSide: 'inside',
    positiveSide: 'outside',
    thresholdGapKm: 80,
    thresholdGapHours: 8,
  },
  north_suez: {
    label: 'north_suez',
    displayName: 'Suez entrance',
    minLon: 32.25,
    maxLon: 32.75,
    minLat: 29.55,
    maxLat: 30.25,
    centerLat: 29.97,
    centerLon: 32.55,
    splitAxis: 'lat',
    splitValue: 29.97,
    negativeSide: 'inside',
    positiveSide: 'outside',
    thresholdGapKm: 50,
    thresholdGapHours: 6,
  },
};

export const RED_SEA_TRANSPONDER_GATE_BY_CROSSING_TYPE = {
  south_outbound: RED_SEA_TRANSPONDER_GATES.south_bab_el_mandeb,
  south_inbound: RED_SEA_TRANSPONDER_GATES.south_bab_el_mandeb,
  north_outbound: RED_SEA_TRANSPONDER_GATES.north_suez,
  north_inbound: RED_SEA_TRANSPONDER_GATES.north_suez,
};

export const RED_SEA_CROSSING_ZONES = {
  'rs-south-out': {
    label: 'rs-south-out',
    minLon: 43.6621,
    maxLon: 52.0656,
    minLat: 10.0391,
    maxLat: 14.5609,
    color: '#d1d5db',
  },
  'rs-south-in': {
    label: 'rs-south-in',
    minLon: 37.1322,
    maxLon: 43.6223,
    minLat: 13.1,
    maxLat: 23.0482,
    color: '#d1d5db',
  },
  'rs-north-in': {
    label: 'rs-north-in',
    minLon: 32.65,
    maxLon: 38.2701,
    minLat: 20.7906,
    maxLat: 28.93,
    color: '#d1d5db',
  },
  'rs-north-out': {
    label: 'rs-north-out',
    minLon: 26.6879,
    maxLon: 35.0082,
    minLat: 29.2,
    maxLat: 34.6263,
    color: '#d1d5db',
  },
};

export const RED_SEA_REFERENCE_AREAS = RED_SEA_CROSSING_ZONE_ORDER.map((zoneId) => RED_SEA_CROSSING_ZONES[zoneId]);

export function isPointInRedSeaCrossingZone(lat, lon, zone) {
  if (!zone) return false;
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= zone.minLat
    && lat <= zone.maxLat
    && lon >= zone.minLon
    && lon <= zone.maxLon;
}

export function getRedSeaCrossingZones(lat, lon) {
  const zones = [];
  for (const zoneId of RED_SEA_CROSSING_ZONE_ORDER) {
    const zone = RED_SEA_CROSSING_ZONES[zoneId];
    if (isPointInRedSeaCrossingZone(lat, lon, zone)) {
      zones.push(zone.label);
    }
  }
  return zones;
}

export function getRedSeaCrossingZone(lat, lon) {
  return getRedSeaCrossingZones(lat, lon)[0] || null;
}

export function isPointInRedSeaTransponderGate(lat, lon, gate) {
  if (!gate) return false;
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= gate.minLat
    && lat <= gate.maxLat
    && lon >= gate.minLon
    && lon <= gate.maxLon;
}

export function getRedSeaTransponderGateSide(lat, lon, gate) {
  if (!isPointInRedSeaTransponderGate(lat, lon, gate)) return null;
  const coordinate = gate.splitAxis === 'lat' ? lat : lon;
  if (!Number.isFinite(coordinate)) return null;
  if (coordinate < gate.splitValue) return gate.negativeSide;
  if (coordinate > gate.splitValue) return gate.positiveSide;
  return null;
}
