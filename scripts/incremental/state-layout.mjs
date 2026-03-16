import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(MODULE_DIR, '..', '..');
const DEFAULT_STATE_DIR = path.join(DEFAULT_ROOT_DIR, 'state');

export const DEFAULT_REGIONS = Object.freeze([
  'hormuz',
  'suez',
  'malacca',
  'cape_good_hope',
  'yemen_channel',
  'south_sri_lanka',
  'mumbai',
  'red_sea',
]);

export const STATE_FILE_NAMES = Object.freeze({
  checkpoints: 'checkpoints.json',
  shipState: 'ship_state.jsonl',
  crossingsLedger: 'crossings-ledger.jsonl',
  linkageLedger: 'linkage-ledger.jsonl',
  candidateLedger: 'candidate-ledger.jsonl',
  publishMeta: 'publish-meta.json',
  coldBaseline: 'cold-baseline.json',
  pipelineLock: 'pipeline.lock',
});

export function resolveStateLayout({ rootDir = DEFAULT_ROOT_DIR, stateDir } = {}) {
  const resolvedStateDir = stateDir ? path.resolve(stateDir) : path.join(path.resolve(rootDir), 'state');
  return {
    rootDir: path.resolve(rootDir),
    stateDir: resolvedStateDir,
    checkpointsPath: path.join(resolvedStateDir, STATE_FILE_NAMES.checkpoints),
    shipStatePath: path.join(resolvedStateDir, STATE_FILE_NAMES.shipState),
    crossingsLedgerPath: path.join(resolvedStateDir, STATE_FILE_NAMES.crossingsLedger),
    linkageLedgerPath: path.join(resolvedStateDir, STATE_FILE_NAMES.linkageLedger),
    candidateLedgerPath: path.join(resolvedStateDir, STATE_FILE_NAMES.candidateLedger),
    publishMetaPath: path.join(resolvedStateDir, STATE_FILE_NAMES.publishMeta),
    coldBaselinePath: path.join(resolvedStateDir, STATE_FILE_NAMES.coldBaseline),
    pipelineLockPath: path.join(resolvedStateDir, STATE_FILE_NAMES.pipelineLock),
  };
}

export function createEmptyCheckpointDocument({
  regions = DEFAULT_REGIONS,
  baselineVersion = null,
  lastHotRunAt = null,
  lastColdRunAt = null,
} = {}) {
  return {
    regions: Object.fromEntries(
      regions.map((regionId) => [
        regionId,
        {
          lastIndexVersion: null,
          lastProcessedObject: null,
          lastProcessedRunUtc: null,
        },
      ]),
    ),
    lastHotRunAt,
    lastColdRunAt,
    baselineVersion,
  };
}

export async function ensureStateLayout(options = {}) {
  const layout = resolveStateLayout(options);
  await fs.mkdir(layout.stateDir, { recursive: true });
  return layout;
}

export { DEFAULT_ROOT_DIR, DEFAULT_STATE_DIR };
