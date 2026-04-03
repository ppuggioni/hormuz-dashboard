import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const BUILD_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'build-data.mjs');

function maybeSetEnv(env, key, value) {
  if (value === null || value === undefined || value === '') {
    delete env[key];
    return;
  }
  env[key] = String(value);
}

export async function runBuildData({
  sourceRoot,
  outputDir,
  prevArtifactDir = null,
  disablePrevMerge = true,
  includePreviousCrossingShipIds = false,
  sourceStartUtc = null,
  sourceEndUtc = null,
  nodeOptions = process.env.NODE_OPTIONS || '--max-old-space-size=16384',
  extraEnv = {},
} = {}) {
  if (!sourceRoot) throw new TypeError('runBuildData requires sourceRoot');
  if (!outputDir) throw new TypeError('runBuildData requires outputDir');

  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedPrevArtifactDir = prevArtifactDir ? path.resolve(prevArtifactDir) : resolvedOutputDir;

  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const env = {
    ...process.env,
    ...extraEnv,
    HORMUZ_SOURCE_MODE: 'local',
    HORMUZ_SOURCE_ROOT: resolvedSourceRoot,
    HORMUZ_OUTPUT_DIR: resolvedOutputDir,
    HORMUZ_PREV_ARTIFACT_DIR: resolvedPrevArtifactDir,
    HORMUZ_DISABLE_PREV_MERGE: disablePrevMerge ? '1' : '0',
    HORMUZ_INCLUDE_PREVIOUS_CROSSING_SHIP_IDS: includePreviousCrossingShipIds ? '1' : '0',
    NODE_OPTIONS: nodeOptions,
  };

  maybeSetEnv(env, 'HORMUZ_SOURCE_START_UTC', sourceStartUtc);
  maybeSetEnv(env, 'HORMUZ_SOURCE_END_UTC', sourceEndUtc);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`build-data exited via signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`build-data exited with code ${code}`));
        return;
      }
      resolve();
    });
  });

  return {
    sourceRoot: resolvedSourceRoot,
    outputDir: resolvedOutputDir,
    prevArtifactDir: resolvedPrevArtifactDir,
    sourceStartUtc: sourceStartUtc || null,
    sourceEndUtc: sourceEndUtc || null,
    disablePrevMerge,
    includePreviousCrossingShipIds,
  };
}

export { REPO_ROOT };
