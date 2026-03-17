import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContinuousRedSeaCrossingsByDay, buildRedSeaCrossings } from '../scripts/build-data.mjs';
import { getRedSeaCrossingZones } from '../src/lib/redSeaCrossingZones.mjs';

test('Red Sea crossings use the most recent eligible prior hit', () => {
  const redSeaSourceObservationsByShip = new Map([
    ['ship-1', [
      { t: '2026-01-01T00:00:00.000Z', lat: 15, lon: 40, sourceRegion: 'suez' },
      { t: '2026-01-05T00:00:00.000Z', lat: 25, lon: 35, sourceRegion: 'red_sea' },
      { t: '2026-01-06T00:00:00.000Z', lat: 12, lon: 44, sourceRegion: 'yemen_channel' },
      { t: '2026-01-08T00:00:00.000Z', lat: 30, lon: 30, sourceRegion: 'suez' },
    ]],
  ]);

  const shipMeta = {
    'ship-1': { shipName: 'Test Vessel', vesselType: 'tanker', flag: 'PA' },
  };

  const { redSeaCrossingEvents, redSeaCrossingRoutes } = buildRedSeaCrossings(redSeaSourceObservationsByShip, shipMeta);

  const southOutbound = redSeaCrossingEvents.find((event) => event.crossingType === 'south_outbound');
  const northOutbound = redSeaCrossingEvents.find((event) => event.crossingType === 'north_outbound');
  assert.ok(southOutbound);
  assert.ok(northOutbound);
  assert.equal(southOutbound.crossingType, 'south_outbound');
  assert.equal(southOutbound.priorZone, 'rs-north-in');
  assert.equal(southOutbound.priorTime, '2026-01-05T00:00:00.000Z');
  assert.equal(southOutbound.deltaDh, '+1d:00h:00m');
  assert.deepEqual(southOutbound.sourceRegionsSeen, ['red_sea', 'yemen_channel']);

  assert.equal(northOutbound.crossingType, 'north_outbound');
  assert.equal(northOutbound.priorZone, 'rs-south-out');
  assert.equal(northOutbound.priorTime, '2026-01-06T00:00:00.000Z');

  const southOutboundRoute = redSeaCrossingRoutes.find((route) => route.crossingType === 'south_outbound');
  assert.ok(southOutboundRoute);
  assert.equal(southOutboundRoute.points.at(-1).sourceRegion, 'yemen_channel');
  assert.deepEqual(southOutboundRoute.points.at(-1).zones, ['rs-south-out']);
});

test('Red Sea daily series stay continuous and zero-filled between event days', () => {
  assert.deepEqual(
    buildContinuousRedSeaCrossingsByDay([
      { crossingType: 'south_outbound', day: '2026-01-06T00:00:00.000Z' },
      { crossingType: 'north_outbound', day: '2026-01-08T00:00:00.000Z' },
    ]).map((row) => ({
      day: row.day,
      south_outbound: row.south_outbound,
      south_inbound: row.south_inbound,
      north_outbound: row.north_outbound,
      north_inbound: row.north_inbound,
      total: row.total,
    })),
    [
      { day: '2026-01-06T00:00:00.000Z', south_outbound: 1, south_inbound: 0, north_outbound: 0, north_inbound: 0, total: 1 },
      { day: '2026-01-07T00:00:00.000Z', south_outbound: 0, south_inbound: 0, north_outbound: 0, north_inbound: 0, total: 0 },
      { day: '2026-01-08T00:00:00.000Z', south_outbound: 0, south_inbound: 0, north_outbound: 1, north_inbound: 0, total: 1 },
    ],
  );
});

test('Red Sea route windows stay bounded to the event context instead of storing the full 30-day raw history', () => {
  const redSeaSourceObservationsByShip = new Map([
    ['ship-2', [
      { t: '2026-01-01T00:00:00.000Z', lat: 30, lon: 30, sourceRegion: 'suez' },
      { t: '2026-01-06T00:00:00.000Z', lat: 18, lon: 46, sourceRegion: 'red_sea' },
      { t: '2026-01-07T00:00:00.000Z', lat: 18, lon: 46, sourceRegion: 'red_sea' },
      { t: '2026-01-10T00:00:00.000Z', lat: 18.5, lon: 45.5, sourceRegion: 'red_sea' },
      { t: '2026-01-15T00:00:00.000Z', lat: 19, lon: 45, sourceRegion: 'yemen_channel' },
      { t: '2026-01-21T00:00:00.000Z', lat: 15, lon: 40, sourceRegion: 'yemen_channel' },
    ]],
  ]);

  const shipMeta = {
    'ship-2': { shipName: 'Long Lookback', vesselType: 'cargo', flag: 'LR' },
  };

  const { redSeaCrossingEvents, redSeaCrossingRoutes } = buildRedSeaCrossings(redSeaSourceObservationsByShip, shipMeta);

  assert.equal(redSeaCrossingEvents.length, 1);
  assert.equal(redSeaCrossingEvents[0].crossingType, 'north_inbound');
  assert.equal(redSeaCrossingEvents[0].priorTime, '2026-01-01T00:00:00.000Z');

  const route = redSeaCrossingRoutes[0];
  assert.equal(route.routeWindowStartTime, '2026-01-07T00:00:00.000Z');
  assert.equal(route.routeWindowEndTime, '2026-01-22T00:00:00.000Z');
  assert.deepEqual(
    route.points.map((point) => point.t),
    [
      '2026-01-07T00:00:00.000Z',
      '2026-01-10T00:00:00.000Z',
      '2026-01-15T00:00:00.000Z',
      '2026-01-21T00:00:00.000Z',
    ],
  );
});

test('Red Sea crossings ignore non-tanker and non-cargo vessels', () => {
  const redSeaSourceObservationsByShip = new Map([
    ['ship-3', [
      { t: '2026-01-01T00:00:00.000Z', lat: 25, lon: 35, sourceRegion: 'suez' },
      { t: '2026-01-02T00:00:00.000Z', lat: 12, lon: 44, sourceRegion: 'yemen_channel' },
    ]],
  ]);

  const shipMeta = {
    'ship-3': { shipName: 'Passenger Vessel', vesselType: 'passenger', flag: 'MT' },
  };

  const { redSeaCrossingEvents, redSeaCrossingRoutes } = buildRedSeaCrossings(redSeaSourceObservationsByShip, shipMeta);

  assert.equal(redSeaCrossingEvents.length, 0);
  assert.equal(redSeaCrossingRoutes.length, 0);
});

test('Red Sea zone helpers return all matching zones for a point', () => {
  assert.deepEqual(getRedSeaCrossingZones(12, 44), ['rs-south-out']);
  assert.deepEqual(getRedSeaCrossingZones(0, 0), []);
});
