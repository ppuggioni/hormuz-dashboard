import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertSafeFullBaseline,
  resolveUsableArchiveDir,
  summarizeCatalogRecords,
} from '../scripts/windowed/safety.mjs';

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('summarizeCatalogRecords totals bytes and region counts', () => {
  const summary = summarizeCatalogRecords([
    { regionId: 'hormuz', fileName: 'a.csv', runUtc: '2026-03-01T00:00:00Z', bytes: 100 },
    { regionId: 'suez', fileName: 'b.csv', runUtc: '2026-03-02T00:00:00Z', bytes: 200 },
    { regionId: 'hormuz', fileName: 'c.csv', runUtc: '2026-03-03T00:00:00Z', bytes: 300 },
  ]);

  assert.equal(summary.fileCount, 3);
  assert.equal(summary.totalBytes, 600);
  assert.equal(summary.firstRunUtc, '2026-03-01T00:00:00Z');
  assert.equal(summary.lastRunUtc, '2026-03-03T00:00:00Z');
  assert.deepEqual(summary.regionFileCounts, { hormuz: 2, suez: 1 });
  assert.deepEqual(summary.regionBytes, { hormuz: 400, suez: 200 });
});

test('assertSafeFullBaseline blocks large archives unless explicitly allowed', () => {
  const summary = summarizeCatalogRecords(
    Array.from({ length: 6 }, (_, index) => ({
      regionId: 'hormuz',
      fileName: `f-${index}.csv`,
      runUtc: `2026-03-0${index + 1}T00:00:00Z`,
      bytes: 300,
    })),
  );

  assert.throws(
    () => assertSafeFullBaseline(summary, { maxFiles: 5, maxBytes: 10_000, allowLargeBaseline: false }),
    /windowed:baseline refused to run on a large historical archive/,
  );

  const allowed = assertSafeFullBaseline(summary, { maxFiles: 5, maxBytes: 10_000, allowLargeBaseline: true });
  assert.equal(allowed.blocked, false);
  assert.equal(allowed.exceedsFileLimit, true);
});

test('resolveUsableArchiveDir prefers the first directory with required artifacts', async () => {
  const missingDir = await makeTempDir('hormuz-windowed-missing-');
  const usableDir = await makeTempDir('hormuz-windowed-usable-');

  for (const fileName of ['processed_core.json', 'processed_paths.json', 'processed_candidates.json']) {
    await fs.writeFile(path.join(usableDir, fileName), '{}\n', 'utf8');
  }

  const resolved = await resolveUsableArchiveDir([missingDir, usableDir]);
  assert.equal(resolved, usableDir);
});
