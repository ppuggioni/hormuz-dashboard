import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBaselineOptionsFromEnv,
  getRefreshOptionsFromEnv,
  getRerunAllOptionsFromEnv,
} from '../scripts/windowed/env-options.mjs';

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('windowed env helpers honor explicit source roots and window overrides', () => {
  withEnv({
    HORMUZ_WINDOWED_BASE_SOURCE_ROOTS: '/tmp/base-a,/tmp/base-b',
    HORMUZ_WINDOWED_SOURCE_ROOTS: '/tmp/recent-a,/tmp/recent-b',
    HORMUZ_WINDOWED_START_UTC: '2026-03-30T00:00:00Z',
    HORMUZ_WINDOWED_END_UTC: '2026-04-03T00:00:00Z',
    HORMUZ_WINDOWED_PREVIOUS_DIR: '/tmp/archive-current',
  }, () => {
    assert.deepEqual(
      getBaselineOptionsFromEnv(),
      { sourceRoots: ['/tmp/base-a', '/tmp/base-b'] },
    );
    assert.deepEqual(
      getRefreshOptionsFromEnv(),
      {
        sourceRoots: ['/tmp/recent-a', '/tmp/recent-b'],
        endUtc: '2026-04-03T00:00:00Z',
        previousDir: '/tmp/archive-current',
      },
    );
    assert.deepEqual(
      getRerunAllOptionsFromEnv(),
      {
        sourceRoots: ['/tmp/recent-a', '/tmp/recent-b'],
        startUtc: '2026-03-30T00:00:00Z',
        endUtc: '2026-04-03T00:00:00Z',
      },
    );
  });
});

test('windowed env helpers omit empty values cleanly', () => {
  withEnv({
    HORMUZ_WINDOWED_BASE_SOURCE_ROOTS: '',
    HORMUZ_WINDOWED_SOURCE_ROOTS: '',
    HORMUZ_WINDOWED_START_UTC: null,
    HORMUZ_WINDOWED_END_UTC: null,
    HORMUZ_WINDOWED_PREVIOUS_DIR: null,
  }, () => {
    assert.deepEqual(getBaselineOptionsFromEnv(), {});
    assert.deepEqual(getRefreshOptionsFromEnv(), {});
    assert.deepEqual(getRerunAllOptionsFromEnv(), {});
  });
});
