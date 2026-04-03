import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mergeArtifactDirectories } from '../scripts/windowed/artifact-merge.mjs';
import {
  filterCatalogByWindow,
  listSourceCatalog,
  stageWindowSourceRoot,
} from '../scripts/windowed/source-window.mjs';

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function wrap(fileKind, data, metadata = {}) {
  return {
    schemaVersion: 'v2',
    fileKind,
    window: fileKind === 'paths' || fileKind === 'candidates' ? 'all' : null,
    generatedAt: '2026-04-03T12:00:00Z',
    sourceRun: null,
    metadata: {
      generatedAt: '2026-04-03T12:00:00Z',
      ...metadata,
    },
    data,
  };
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

test('mergeArtifactDirectories replaces only the configured recent slice', async () => {
  const previousDir = await makeTempDir('hormuz-windowed-prev-');
  const recentDir = await makeTempDir('hormuz-windowed-recent-');
  const outputDir = await makeTempDir('hormuz-windowed-out-');

  await writeJson(path.join(previousDir, 'processed_core.json'), wrap('core', {
    vesselTypes: ['tanker'],
    shipMeta: { 'ship-1': { flag: 'PA' } },
    crossingEvents: [
      { eventId: 'old-a', shipId: 'ship-1', direction: 'west_to_east', t: '2026-03-01T00:00:00Z', hour: '2026-03-01T00:00:00Z' },
      { eventId: 'old-b', shipId: 'ship-1', direction: 'east_to_west', t: '2026-03-10T00:00:00Z', hour: '2026-03-10T00:00:00Z' },
    ],
    crossingsByHour: [],
    redSeaCrossingTypes: [],
    redSeaCrossingsByDay: [],
    redSeaCrossingEvents: [],
    linkageEvents: [
      {
        shipId: 'ship-1',
        fromRegion: 'hormuz_west',
        toRegion: 'suez',
        hormuzWestTime: '2026-03-10T00:00:00Z',
        otherRegionTime: '2026-03-10T12:00:00Z',
        deltaHours: 12,
      },
    ],
    confirmedCrossingExclusions: [],
  }));
  await writeJson(path.join(previousDir, 'processed_paths.json'), wrap('paths', {
    crossingPaths: [
      {
        shipId: 'ship-1',
        shipName: 'Alpha',
        vesselType: 'tanker',
        flag: 'PA',
        primaryDirection: 'mixed',
        directionCounts: { east_to_west: 1, west_to_east: 1 },
        points: [
          { t: '2026-03-01T00:00:00Z', lat: 1, lon: 1 },
          { t: '2026-03-10T00:00:00Z', lat: 2, lon: 2 },
        ],
      },
    ],
    redSeaCrossingRoutes: [],
  }));
  await writeJson(path.join(previousDir, 'processed_candidates.json'), wrap('candidates', {
    tankerCandidates: [],
    cargoCandidates: [],
    tankerCandidateEvents: [
      { eventId: 'cand-old', shipId: 'ship-1', shipName: 'Alpha', lastSeenAt: '2026-03-02T00:00:00Z', confidenceBand: 'high' },
      { eventId: 'cand-replaced', shipId: 'ship-1', shipName: 'Alpha', lastSeenAt: '2026-03-10T00:00:00Z', confidenceBand: 'low' },
    ],
    cargoCandidateEvents: [],
    relevantExternalPoints: [],
  }));

  await writeJson(path.join(recentDir, 'processed_core.json'), wrap('core', {
    vesselTypes: ['tanker'],
    shipMeta: { 'ship-1': { flag: 'PA' } },
    crossingEvents: [
      { eventId: 'old-b', shipId: 'ship-1', direction: 'west_to_east', t: '2026-03-10T00:00:00Z', hour: '2026-03-10T00:00:00Z' },
    ],
    crossingsByHour: [],
    redSeaCrossingTypes: [],
    redSeaCrossingsByDay: [],
    redSeaCrossingEvents: [],
    linkageEvents: [
      {
        shipId: 'ship-1',
        fromRegion: 'hormuz_west',
        toRegion: 'suez',
        hormuzWestTime: '2026-03-10T00:00:00Z',
        otherRegionTime: '2026-03-10T06:00:00Z',
        deltaHours: 6,
      },
    ],
    confirmedCrossingExclusions: [],
  }));
  await writeJson(path.join(recentDir, 'processed_paths.json'), wrap('paths', {
    crossingPaths: [
      {
        shipId: 'ship-1',
        shipName: 'Alpha',
        vesselType: 'tanker',
        flag: 'PA',
        primaryDirection: 'mixed',
        directionCounts: { east_to_west: 0, west_to_east: 1 },
        points: [
          { t: '2026-03-10T00:00:00Z', lat: 9, lon: 9 },
          { t: '2026-03-11T00:00:00Z', lat: 10, lon: 10 },
        ],
      },
    ],
    redSeaCrossingRoutes: [],
  }));
  await writeJson(path.join(recentDir, 'processed_candidates.json'), wrap('candidates', {
    tankerCandidates: [{ shipId: 'ship-1', shipName: 'Alpha', confidenceBand: 'high' }],
    cargoCandidates: [],
    tankerCandidateEvents: [
      { eventId: 'cand-replaced', shipId: 'ship-1', shipName: 'Alpha', lastSeenAt: '2026-03-10T00:00:00Z', confidenceBand: 'high' },
    ],
    cargoCandidateEvents: [],
    relevantExternalPoints: [{ shipId: 'ship-1', region: 'suez', t: '2026-03-10T03:00:00Z', lat: 1, lon: 1 }],
  }));

  await mergeArtifactDirectories({
    previousDir,
    recentDir,
    outputDir,
    replaceStartUtc: '2026-03-09T00:00:00Z',
  });

  const mergedCore = JSON.parse(await fs.readFile(path.join(outputDir, 'processed_core.json'), 'utf8'));
  const mergedPaths = JSON.parse(await fs.readFile(path.join(outputDir, 'processed_paths.json'), 'utf8'));
  const mergedCandidates = JSON.parse(await fs.readFile(path.join(outputDir, 'processed_candidates.json'), 'utf8'));

  assert.deepEqual(
    mergedCore.data.crossingEvents.map((event) => event.eventId),
    ['old-a', 'old-b'],
  );
  assert.equal(mergedCore.data.crossingEvents[1].direction, 'west_to_east');
  assert.equal(mergedCore.data.linkageEvents[0].deltaHours, 6);
  assert.deepEqual(
    mergedPaths.data.crossingPaths[0].points.map((point) => point.t),
    ['2026-03-01T00:00:00Z', '2026-03-10T00:00:00Z', '2026-03-11T00:00:00Z'],
  );
  assert.equal(mergedCandidates.data.tankerCandidates.length, 1);
  assert.equal(mergedCandidates.data.tankerCandidateEvents.length, 2);
  assert.equal(
    mergedCandidates.data.tankerCandidateEvents.find((event) => event.eventId === 'cand-replaced').confidenceBand,
    'high',
  );
});

test('mergeArtifactDirectories can assemble a commit slice from an empty archive', async () => {
  const recentDir = await makeTempDir('hormuz-windowed-recent-empty-');
  const outputDir = await makeTempDir('hormuz-windowed-out-empty-');

  await writeJson(path.join(recentDir, 'processed_core.json'), wrap('core', {
    vesselTypes: ['tanker'],
    shipMeta: { 'ship-1': { flag: 'PA' } },
    crossingEvents: [
      { eventId: 'context-only', shipId: 'ship-1', direction: 'west_to_east', t: '2026-03-01T00:00:00Z', hour: '2026-03-01T00:00:00Z' },
      { eventId: 'commit', shipId: 'ship-1', direction: 'east_to_west', t: '2026-03-08T00:00:00Z', hour: '2026-03-08T00:00:00Z' },
    ],
    crossingsByHour: [],
    redSeaCrossingTypes: [],
    redSeaCrossingsByDay: [],
    redSeaCrossingEvents: [],
    linkageEvents: [],
    confirmedCrossingExclusions: [],
  }));
  await writeJson(path.join(recentDir, 'processed_paths.json'), wrap('paths', {
    crossingPaths: [
      {
        shipId: 'ship-1',
        shipName: 'Alpha',
        vesselType: 'tanker',
        flag: 'PA',
        primaryDirection: 'mixed',
        directionCounts: { east_to_west: 1, west_to_east: 1 },
        points: [
          { t: '2026-03-01T00:00:00Z', lat: 1, lon: 1 },
          { t: '2026-03-08T00:00:00Z', lat: 2, lon: 2 },
        ],
      },
    ],
    redSeaCrossingRoutes: [],
  }));
  await writeJson(path.join(recentDir, 'processed_candidates.json'), wrap('candidates', {
    tankerCandidates: [],
    cargoCandidates: [],
    tankerCandidateEvents: [
      { eventId: 'context-candidate', shipId: 'ship-1', shipName: 'Alpha', lastSeenAt: '2026-03-01T00:00:00Z', confidenceBand: 'low' },
      { eventId: 'commit-candidate', shipId: 'ship-1', shipName: 'Alpha', lastSeenAt: '2026-03-08T00:00:00Z', confidenceBand: 'high' },
    ],
    cargoCandidateEvents: [],
    relevantExternalPoints: [],
  }));

  await mergeArtifactDirectories({
    previousDir: null,
    recentDir,
    outputDir,
    replaceStartUtc: '2026-03-08T00:00:00Z',
    replaceEndUtc: '2026-03-15T00:00:00Z',
  });

  const mergedCore = JSON.parse(await fs.readFile(path.join(outputDir, 'processed_core.json'), 'utf8'));
  const mergedPaths = JSON.parse(await fs.readFile(path.join(outputDir, 'processed_paths.json'), 'utf8'));
  const mergedCandidates = JSON.parse(await fs.readFile(path.join(outputDir, 'processed_candidates.json'), 'utf8'));

  assert.deepEqual(mergedCore.data.crossingEvents.map((event) => event.eventId), ['commit']);
  assert.deepEqual(mergedPaths.data.crossingPaths[0].points.map((point) => point.t), ['2026-03-08T00:00:00Z']);
  assert.deepEqual(mergedCandidates.data.tankerCandidateEvents.map((event) => event.eventId), ['commit-candidate']);
});

test('source window helpers combine multiple frozen roots and stage a filtered source tree', async () => {
  const rootA = await makeTempDir('hormuz-windowed-root-a-');
  const rootB = await makeTempDir('hormuz-windowed-root-b-');
  await fs.writeFile(path.join(rootA, 'hormuz_2026_03_01_00_00_00.csv'), 'ship_id,latitude,longitude,capture_utc\n1,1,1,2026-03-01T00:00:00Z\n');
  await fs.writeFile(path.join(rootB, 'suez_2026_03_10_00_00_00.csv'), 'ship_id,latitude,longitude,capture_utc\n2,2,2,2026-03-10T00:00:00Z\n');

  const catalog = await listSourceCatalog({ sourceRoots: [rootA, rootB] });
  assert.equal(catalog.length, 2);

  const filtered = filterCatalogByWindow(catalog, {
    startUtc: '2026-03-05T00:00:00Z',
    endUtc: '2026-03-11T00:00:00Z',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].regionId, 'suez');

  const stagingDir = await makeTempDir('hormuz-windowed-staging-');
  await stageWindowSourceRoot({ files: filtered, stagingDir });
  const stagedEntries = (await fs.readdir(stagingDir)).filter((name) => name.endsWith('.csv'));
  assert.deepEqual(stagedEntries, ['suez_2026_03_10_00_00_00.csv']);
});
