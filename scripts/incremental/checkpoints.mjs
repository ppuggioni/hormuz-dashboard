import fs from 'node:fs/promises';
import { createEmptyCheckpointDocument, ensureStateLayout, resolveStateLayout } from './state-layout.mjs';

async function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function mergeCheckpointDocument(currentDoc, nextDoc) {
  return {
    ...currentDoc,
    ...nextDoc,
    regions: {
      ...(currentDoc.regions || {}),
      ...(nextDoc.regions || {}),
    },
  };
}

export async function loadCheckpoints(options = {}) {
  const layout = resolveStateLayout(options);
  try {
    const raw = await fs.readFile(layout.checkpointsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return mergeCheckpointDocument(createEmptyCheckpointDocument(options), parsed);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return createEmptyCheckpointDocument(options);
    }
    throw err;
  }
}

export async function saveCheckpoints(checkpoints, options = {}) {
  const layout = await ensureStateLayout(options);
  const nextDoc = mergeCheckpointDocument(createEmptyCheckpointDocument(options), checkpoints);
  await atomicWriteJson(layout.checkpointsPath, nextDoc);
  return nextDoc;
}

export async function updateRegionCheckpoint(regionId, patch, options = {}) {
  const current = await loadCheckpoints(options);
  const next = {
    ...current,
    regions: {
      ...current.regions,
      [regionId]: {
        lastIndexVersion: null,
        lastProcessedObject: null,
        lastProcessedRunUtc: null,
        ...(current.regions?.[regionId] || {}),
        ...patch,
      },
    },
  };
  await saveCheckpoints(next, options);
  return next;
}

export async function updateCheckpointMetadata(patch, options = {}) {
  const current = await loadCheckpoints(options);
  const next = {
    ...current,
    ...patch,
  };
  await saveCheckpoints(next, options);
  return next;
}
