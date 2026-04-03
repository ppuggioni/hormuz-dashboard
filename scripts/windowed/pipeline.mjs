import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, runBuildData } from './build-runner.mjs';
import { mergeArtifactDirectories } from './artifact-merge.mjs';
import {
  assertSafeFullBaseline,
  resolveUsableArchiveDir,
  summarizeCatalogRecords,
} from './safety.mjs';
import {
  filterCatalogByWindow,
  listSourceCatalog,
  stageWindowSourceRoot,
  summarizeCatalogRange,
} from './source-window.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNTIME_ROOT = path.join(REPO_ROOT, 'data', 'windowed-pipeline');
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, 'public', 'data-windowed');
const DEFAULT_ARCHIVE_FALLBACK_DIR = path.join(REPO_ROOT, 'public', 'data');
const DEFAULT_CONTEXT_DAYS = Number(process.env.HORMUZ_WINDOWED_CONTEXT_DAYS || 14);
const DEFAULT_REWRITE_DAYS = Number(process.env.HORMUZ_WINDOWED_REWRITE_DAYS || 4);
const DEFAULT_COMMIT_DAYS = Number(process.env.HORMUZ_WINDOWED_COMMIT_DAYS || 7);

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addDays(iso, days) {
  return new Date(+new Date(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

function subtractDays(iso, days) {
  return addDays(iso, -days);
}

function parseRoots(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => path.resolve(part));
}

async function findLatestSnapshotRoot() {
  const snapshotsRoot = path.join(REPO_ROOT, 'data', 'input-snapshots');
  try {
    const entries = await fs.readdir(snapshotsRoot, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(snapshotsRoot, entry.name))
      .sort()
      .reverse();
    for (const dirPath of dirs) {
      try {
        await fs.access(path.join(dirPath, 'manifest.json'));
        return dirPath;
      } catch {}
    }
  } catch {}
  return null;
}

async function resolveDefaultSourceRoots(mode) {
  const snapshotRoot = await findLatestSnapshotRoot();
  if (!snapshotRoot) {
    return [path.resolve(process.env.HORMUZ_SOURCE_ROOT || path.join(REPO_ROOT, '..'))];
  }

  if (mode === 'baseline') {
    return [path.join(snapshotRoot, 'base')];
  }

  return [path.join(snapshotRoot, 'base'), path.join(snapshotRoot, 'replay')];
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function readStateManifest(runtimeRoot) {
  try {
    return JSON.parse(await fs.readFile(path.join(runtimeRoot, 'state.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeStateManifest(runtimeRoot, payload) {
  await writeJson(path.join(runtimeRoot, 'state.json'), payload);
}

function makeRunId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

async function prepareWindowRun({
  runDir,
  catalog,
  startUtc = null,
  endUtc = null,
} = {}) {
  const files = filterCatalogByWindow(catalog, { startUtc, endUtc });
  const sourceDir = path.join(runDir, 'source');
  await stageWindowSourceRoot({
    files,
    stagingDir: sourceDir,
    manifest: {
      startUtc,
      endUtc,
      fileCount: files.length,
      summary: summarizeCatalogRange(files),
    },
  });

  return {
    sourceDir,
    files,
    summary: summarizeCatalogRange(files),
  };
}

function buildPipelineConfig({
  runtimeRoot = process.env.HORMUZ_WINDOWED_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT,
  outputRoot = process.env.HORMUZ_WINDOWED_OUTPUT_ROOT || DEFAULT_OUTPUT_ROOT,
  contextDays = DEFAULT_CONTEXT_DAYS,
  rewriteDays = DEFAULT_REWRITE_DAYS,
  commitDays = DEFAULT_COMMIT_DAYS,
} = {}) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);
  return {
    runtimeRoot: resolvedRuntimeRoot,
    outputRoot: resolvedOutputRoot,
    baselineOutputDir: path.join(resolvedOutputRoot, 'baseline'),
    currentOutputDir: path.join(resolvedOutputRoot, 'current'),
    fullRerunOutputDir: path.join(resolvedOutputRoot, 'full-rerun'),
    contextDays,
    rewriteDays,
    commitDays,
  };
}

function validatePipelineConfig(config) {
  for (const [key, value] of [
    ['contextDays', config.contextDays],
    ['rewriteDays', config.rewriteDays],
    ['commitDays', config.commitDays],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${key} must be a positive number`);
    }
  }
  if (config.rewriteDays > config.contextDays) {
    throw new RangeError('rewriteDays must be less than or equal to contextDays');
  }
  if (config.commitDays > config.contextDays) {
    throw new RangeError('commitDays must be less than or equal to contextDays');
  }
  return config;
}

async function writeBlockedBaselineManifest(runtimeRoot, payload) {
  await writeStateManifest(runtimeRoot, {
    ...(await readStateManifest(runtimeRoot)),
    lastBaselineBlocked: payload,
  });
}

export async function createBaseline(options = {}) {
  const config = validatePipelineConfig(buildPipelineConfig(options));
  const sourceRoots = options.sourceRoots?.length
    ? options.sourceRoots.map((root) => path.resolve(root))
    : await resolveDefaultSourceRoots('baseline');

  await ensureDir(config.runtimeRoot);
  await ensureDir(config.outputRoot);

  const catalog = await listSourceCatalog({ sourceRoots });
  const catalogSummary = summarizeCatalogRecords(catalog);
  let baselineRisk = null;
  try {
    baselineRisk = assertSafeFullBaseline(catalogSummary, {
      allowLargeBaseline: options.allowLargeBaseline,
      maxFiles: options.maxBaselineFiles,
      maxBytes: options.maxBaselineBytes,
    });
  } catch (error) {
    await writeBlockedBaselineManifest(config.runtimeRoot, {
      mode: 'baseline',
      createdAt: new Date().toISOString(),
      sourceRoots,
      catalogSummary,
      error: error.message,
    });
    throw error;
  }
  const runId = makeRunId('baseline');
  const runDir = await ensureDir(path.join(config.runtimeRoot, 'runs', runId));
  const { sourceDir, files, summary } = await prepareWindowRun({
    runDir,
    catalog,
  });
  const artifactsDir = path.join(runDir, 'artifacts');

  await runBuildData({
    sourceRoot: sourceDir,
    outputDir: artifactsDir,
    prevArtifactDir: artifactsDir,
    disablePrevMerge: true,
    includePreviousCrossingShipIds: false,
  });

  await fs.rm(config.baselineOutputDir, { recursive: true, force: true });
  await fs.cp(artifactsDir, config.baselineOutputDir, { recursive: true });
  if (options.initializeCurrent !== false) {
    await fs.rm(config.currentOutputDir, { recursive: true, force: true });
    await fs.cp(artifactsDir, config.currentOutputDir, { recursive: true });
  }

  const manifest = {
    mode: 'baseline',
    createdAt: new Date().toISOString(),
    sourceRoots,
    summary,
    catalogSummary,
    baselineRisk,
    fileCount: files.length,
    baselineOutputDir: config.baselineOutputDir,
    currentOutputDir: options.initializeCurrent === false ? null : config.currentOutputDir,
  };
  await writeJson(path.join(runDir, 'manifest.json'), manifest);
  await writeStateManifest(config.runtimeRoot, {
    ...(await readStateManifest(config.runtimeRoot)),
    pipeline: {
      contextDays: config.contextDays,
      rewriteDays: config.rewriteDays,
      commitDays: config.commitDays,
    },
    baseline: manifest,
  });

  return manifest;
}

export async function refreshRollingWindow(options = {}) {
  const config = validatePipelineConfig(buildPipelineConfig(options));
  const sourceRoots = options.sourceRoots?.length
    ? options.sourceRoots.map((root) => path.resolve(root))
    : await resolveDefaultSourceRoots('refresh');
  const endUtc = toIso(options.endUtc || process.env.HORMUZ_WINDOWED_END_UTC || new Date().toISOString());
  const contextStartUtc = subtractDays(endUtc, config.contextDays);
  const replaceStartUtc = subtractDays(endUtc, config.rewriteDays);

  await ensureDir(config.runtimeRoot);
  await ensureDir(config.outputRoot);

  const catalog = await listSourceCatalog({ sourceRoots });
  const catalogSummary = summarizeCatalogRecords(catalog);
  const previousCandidates = options.previousDir
    ? [options.previousDir]
    : [config.currentOutputDir, DEFAULT_ARCHIVE_FALLBACK_DIR];
  const previousDir = await resolveUsableArchiveDir(previousCandidates);
  if (!previousDir) {
    throw new Error(
      options.previousDir
        ? `windowed:refresh could not use explicit archive directory: ${path.resolve(options.previousDir)}`
        : 'windowed:refresh could not find a usable archive artifact directory. ' +
          'Provide HORMUZ_WINDOWED_PREVIOUS_DIR or seed public/data-windowed/current or public/data first.',
    );
  }
  const previousDirSource = options.previousDir
    ? 'explicit'
    : previousDir === path.resolve(config.currentOutputDir)
      ? 'windowed-current'
      : previousDir === path.resolve(DEFAULT_ARCHIVE_FALLBACK_DIR)
        ? 'repo-public-data'
        : 'resolved';
  const runId = makeRunId('refresh');
  const runDir = await ensureDir(path.join(config.runtimeRoot, 'runs', runId));
  const { sourceDir, files, summary } = await prepareWindowRun({
    runDir,
    catalog,
    startUtc: contextStartUtc,
    endUtc,
  });
  const recentArtifactsDir = path.join(runDir, 'recent-artifacts');

  await runBuildData({
    sourceRoot: sourceDir,
    outputDir: recentArtifactsDir,
    prevArtifactDir: previousDir,
    disablePrevMerge: true,
    includePreviousCrossingShipIds: true,
  });

  await mergeArtifactDirectories({
    previousDir,
    recentDir: recentArtifactsDir,
    outputDir: config.currentOutputDir,
    replaceStartUtc,
    replaceEndUtc: null,
  });

  const manifest = {
    mode: 'refresh',
    createdAt: new Date().toISOString(),
    sourceRoots,
    endUtc,
    contextStartUtc,
    replaceStartUtc,
    summary,
    catalogSummary,
    fileCount: files.length,
    previousDir,
    previousDirSource,
    recentArtifactsDir,
    currentOutputDir: config.currentOutputDir,
  };
  await writeJson(path.join(runDir, 'manifest.json'), manifest);
  await writeStateManifest(config.runtimeRoot, {
    ...(await readStateManifest(config.runtimeRoot)),
    pipeline: {
      contextDays: config.contextDays,
      rewriteDays: config.rewriteDays,
      commitDays: config.commitDays,
    },
    lastRefresh: manifest,
  });

  return manifest;
}

export async function rerunAllWindowed(options = {}) {
  const config = validatePipelineConfig(buildPipelineConfig(options));
  const sourceRoots = options.sourceRoots?.length
    ? options.sourceRoots.map((root) => path.resolve(root))
    : await resolveDefaultSourceRoots('rerun-all');

  await ensureDir(config.runtimeRoot);
  await ensureDir(config.outputRoot);

  const catalog = await listSourceCatalog({ sourceRoots });
  const catalogSummary = summarizeCatalogRecords(catalog);
  const overallStartUtc = toIso(options.startUtc || process.env.HORMUZ_WINDOWED_START_UTC || catalogSummary.firstRunUtc);
  const overallEndUtc = toIso(options.endUtc || process.env.HORMUZ_WINDOWED_END_UTC || addDays(catalogSummary.lastRunUtc, 1 / 24 / 60 / 60));
  const runId = makeRunId('rerun-all');
  const runDir = await ensureDir(path.join(config.runtimeRoot, 'runs', runId));
  const assembledOutputDir = path.join(runDir, 'assembled-artifacts');
  await fs.rm(assembledOutputDir, { recursive: true, force: true });
  await ensureDir(assembledOutputDir);

  const chunkManifests = [];
  let commitStartUtc = overallStartUtc;
  let lastRecentArtifactsDir = null;

  while (+new Date(commitStartUtc) < +new Date(overallEndUtc)) {
    const commitEndUtc = toIso(Math.min(
      +new Date(addDays(commitStartUtc, config.commitDays)),
      +new Date(overallEndUtc),
    ));
    const contextStartUtc = toIso(Math.max(
      +new Date(subtractDays(commitEndUtc, config.contextDays)),
      +new Date(overallStartUtc),
    ));
    const chunkId = commitStartUtc.replace(/[:.]/g, '-');
    const chunkDir = await ensureDir(path.join(runDir, 'chunks', chunkId));
    const { sourceDir, files, summary } = await prepareWindowRun({
      runDir: chunkDir,
      catalog,
      startUtc: contextStartUtc,
      endUtc: commitEndUtc,
    });
    const recentArtifactsDir = path.join(chunkDir, 'recent-artifacts');
    await runBuildData({
      sourceRoot: sourceDir,
      outputDir: recentArtifactsDir,
      prevArtifactDir: assembledOutputDir,
      disablePrevMerge: true,
      includePreviousCrossingShipIds: true,
    });

    await mergeArtifactDirectories({
      previousDir: chunkManifests.length ? assembledOutputDir : null,
      recentDir: recentArtifactsDir,
      outputDir: assembledOutputDir,
      replaceStartUtc: commitStartUtc,
      replaceEndUtc: commitEndUtc,
    });

    chunkManifests.push({
      commitStartUtc,
      commitEndUtc,
      contextStartUtc,
      contextEndUtc: commitEndUtc,
      fileCount: files.length,
      summary,
      catalogSummary: summarizeCatalogRecords(files),
      chunkDir,
    });
    lastRecentArtifactsDir = recentArtifactsDir;
    commitStartUtc = commitEndUtc;
  }

  if (lastRecentArtifactsDir) {
    for (const fileName of [
      'confirmed_crossing_exclusions.json',
      'processed_playback_latest.json',
      'processed_shipmeta_latest.json',
      'processed_external_latest.json',
      'processed_playback_24h.json',
      'processed_shipmeta_24h.json',
      'processed_external_24h.json',
      'processed_playback_48h.json',
      'processed_shipmeta_48h.json',
      'processed_external_48h.json',
    ]) {
      try {
        await fs.copyFile(
          path.join(lastRecentArtifactsDir, fileName),
          path.join(assembledOutputDir, fileName),
        );
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  await fs.rm(config.fullRerunOutputDir, { recursive: true, force: true });
  await fs.cp(assembledOutputDir, config.fullRerunOutputDir, { recursive: true });

  const manifest = {
    mode: 'rerun-all',
    createdAt: new Date().toISOString(),
    sourceRoots,
    catalogSummary,
    overallStartUtc,
    overallEndUtc,
    fullRerunOutputDir: config.fullRerunOutputDir,
    chunkCount: chunkManifests.length,
    chunks: chunkManifests,
  };
  await writeJson(path.join(runDir, 'manifest.json'), manifest);
  await writeStateManifest(config.runtimeRoot, {
    ...(await readStateManifest(config.runtimeRoot)),
    pipeline: {
      contextDays: config.contextDays,
      rewriteDays: config.rewriteDays,
      commitDays: config.commitDays,
    },
    lastFullRerun: manifest,
  });

  return manifest;
}

async function main() {
  const command = process.argv[2];
  const sourceRootsEnv = parseRoots(process.env.HORMUZ_WINDOWED_SOURCE_ROOTS || '');
  const baseSourceRootsEnv = parseRoots(process.env.HORMUZ_WINDOWED_BASE_SOURCE_ROOTS || '');

  if (command === 'baseline') {
    const result = await createBaseline({
      sourceRoots: baseSourceRootsEnv,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'refresh') {
    const result = await refreshRollingWindow({
      sourceRoots: sourceRootsEnv,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'rerun-all') {
    const result = await rerunAllWindowed({
      sourceRoots: sourceRootsEnv,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error('Usage: node scripts/windowed/pipeline.mjs <baseline|refresh|rerun-all>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
