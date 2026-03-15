import fs from 'node:fs/promises';
import { loadCheckpoints, updateCheckpointMetadata } from './checkpoints.mjs';
import { ensureStateLayout, resolveStateLayout } from './state-layout.mjs';

async function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

export function createBaselineVersion(prefix = 'cold', at = new Date()) {
  return `${prefix}-${new Date(at).toISOString()}`;
}

export async function loadColdBaseline(options = {}) {
  const layout = resolveStateLayout(options);
  try {
    const raw = await fs.readFile(layout.coldBaselinePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      const checkpoints = await loadCheckpoints(options);
      return checkpoints.baselineVersion
        ? { version: checkpoints.baselineVersion, generatedAt: null, source: 'checkpoint' }
        : null;
    }
    throw err;
  }
}

export async function saveColdBaseline(baseline, options = {}) {
  if (!baseline?.version) {
    throw new TypeError('saveColdBaseline requires a baseline.version');
  }
  const layout = await ensureStateLayout(options);
  const normalized = {
    generatedAt: null,
    source: 'cold_rebuild',
    notes: null,
    ...baseline,
  };
  await atomicWriteJson(layout.coldBaselinePath, normalized);
  await updateCheckpointMetadata(
    {
      baselineVersion: normalized.version,
      lastColdRunAt: normalized.generatedAt || null,
    },
    options,
  );
  return normalized;
}
