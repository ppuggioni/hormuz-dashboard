import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  acquirePipelineLock,
  appendJsonl,
  createBaselineVersion,
  ensureStateLayout,
  loadCheckpoints,
  loadColdBaseline,
  readJsonl,
  readPipelineLock,
  releasePipelineLock,
  saveCheckpoints,
  saveColdBaseline,
  updateRegionCheckpoint,
  writeJsonl,
} from '../scripts/incremental/index.mjs';

async function makeTempStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hormuz-incremental-'));
}

test('state layout and checkpoint helpers create the Phase 1 scaffold safely', async () => {
  const stateDir = await makeTempStateDir();
  await ensureStateLayout({ stateDir, regions: ['hormuz', 'suez'] });

  const initial = await loadCheckpoints({ stateDir, regions: ['hormuz', 'suez'] });
  assert.equal(initial.baselineVersion, null);
  assert.deepEqual(Object.keys(initial.regions), ['hormuz', 'suez']);

  await saveCheckpoints(
    {
      baselineVersion: 'cold-2026-03-15T01:08:00.000Z',
      lastHotRunAt: '2026-03-15T22:40:00Z',
    },
    { stateDir, regions: ['hormuz', 'suez'] },
  );

  const saved = await loadCheckpoints({ stateDir, regions: ['hormuz', 'suez'] });
  assert.equal(saved.baselineVersion, 'cold-2026-03-15T01:08:00.000Z');
  assert.equal(saved.lastHotRunAt, '2026-03-15T22:40:00Z');

  const updated = await updateRegionCheckpoint(
    'hormuz',
    {
      lastIndexVersion: '2026-03-15T22:35:54Z',
      lastProcessedObject: 'hormuz/2026-03-15/file.csv',
      lastProcessedRunUtc: '2026-03-15T22:35:54Z',
    },
    { stateDir, regions: ['hormuz', 'suez'] },
  );
  assert.equal(updated.regions.hormuz.lastProcessedObject, 'hormuz/2026-03-15/file.csv');
});

test('JSONL helpers preserve append and rewrite flows for ledgers/state files', async () => {
  const stateDir = await makeTempStateDir();
  const filePath = path.join(stateDir, 'ship_state.jsonl');

  await appendJsonl(filePath, { shipId: '1', side: 'west' });
  await appendJsonl(filePath, { shipId: '2', side: 'east' });
  assert.deepEqual(await readJsonl(filePath), [
    { shipId: '1', side: 'west' },
    { shipId: '2', side: 'east' },
  ]);

  await writeJsonl(filePath, [
    { shipId: '3', side: 'unknown' },
    { shipId: '4', side: 'west' },
  ]);
  assert.deepEqual(await readJsonl(filePath), [
    { shipId: '3', side: 'unknown' },
    { shipId: '4', side: 'west' },
  ]);
});

test('pipeline lock helpers enforce single-writer exclusion between hot and cold runs', async () => {
  const stateDir = await makeTempStateDir();
  const hotLock = await acquirePipelineLock('hot', { stateDir });
  const visible = await readPipelineLock({ stateDir });

  assert.equal(visible.mode, 'hot');
  assert.equal(visible.lockId, hotLock.lockId);

  await assert.rejects(
    acquirePipelineLock('cold', { stateDir }),
    /another pipeline writer is active/,
  );

  await releasePipelineLock(hotLock, { stateDir });
  assert.equal(await readPipelineLock({ stateDir }), null);
});

test('baseline metadata persists independently and syncs baselineVersion into checkpoints', async () => {
  const stateDir = await makeTempStateDir();
  const version = createBaselineVersion('cold', '2026-03-15T01:08:00Z');

  await saveColdBaseline(
    {
      version,
      generatedAt: '2026-03-15T01:08:00Z',
      source: 'cold_rebuild',
      notes: 'Phase 1 scaffold smoke test',
    },
    { stateDir, regions: ['hormuz'] },
  );

  const baseline = await loadColdBaseline({ stateDir, regions: ['hormuz'] });
  const checkpoints = await loadCheckpoints({ stateDir, regions: ['hormuz'] });

  assert.equal(baseline.version, version);
  assert.equal(checkpoints.baselineVersion, version);
  assert.equal(checkpoints.lastColdRunAt, '2026-03-15T01:08:00Z');
});
