import fs from 'node:fs/promises';
import path from 'node:path';

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

export function buildRegionFileRegex(regionId) {
  const escaped = String(regionId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}_(\\d{4})_(\\d{2})_(\\d{2})_(\\d{2})_(\\d{2})_(\\d{2})\\.csv$`);
}

export function parseRunUtcFromFileName(regionId, fileName) {
  const match = String(fileName || '').match(buildRegionFileRegex(regionId));
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

function normalizeBoundary(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isWithinWindow(runUtc, { startUtc = null, endUtc = null } = {}) {
  const runMs = +new Date(runUtc);
  if (!Number.isFinite(runMs)) return false;
  if (startUtc && runMs < +new Date(startUtc)) return false;
  if (endUtc && runMs >= +new Date(endUtc)) return false;
  return true;
}

export async function listSourceCatalog({
  sourceRoots,
  regions = DEFAULT_REGIONS,
} = {}) {
  const roots = (Array.isArray(sourceRoots) ? sourceRoots : [sourceRoots])
    .map((root) => path.resolve(String(root || '').trim()))
    .filter(Boolean);
  const fileMap = new Map();
  const regexByRegion = new Map(regions.map((regionId) => [regionId, buildRegionFileRegex(regionId)]));

  for (const sourceRoot of roots) {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.csv')) continue;
      let regionId = null;
      for (const candidateRegion of regions) {
        if (regexByRegion.get(candidateRegion).test(entry.name)) {
          regionId = candidateRegion;
          break;
        }
      }
      if (!regionId) continue;
      if (fileMap.has(entry.name)) continue;

      const runUtc = parseRunUtcFromFileName(regionId, entry.name);
      if (!runUtc) continue;
      const filePath = path.join(sourceRoot, entry.name);
      const stats = await fs.stat(filePath);
      fileMap.set(entry.name, {
        regionId,
        fileName: entry.name,
        runUtc,
        filePath,
        sourceRoot,
        bytes: stats.size,
        mtimeUtc: stats.mtime.toISOString(),
      });
    }
  }

  return [...fileMap.values()].sort((a, b) => {
    if (a.runUtc !== b.runUtc) return a.runUtc.localeCompare(b.runUtc);
    if (a.regionId !== b.regionId) return a.regionId.localeCompare(b.regionId);
    return a.fileName.localeCompare(b.fileName);
  });
}

export function filterCatalogByWindow(catalog, {
  startUtc = null,
  endUtc = null,
} = {}) {
  const normalizedStartUtc = normalizeBoundary(startUtc);
  const normalizedEndUtc = normalizeBoundary(endUtc);
  return (catalog || []).filter((record) => isWithinWindow(record.runUtc, {
    startUtc: normalizedStartUtc,
    endUtc: normalizedEndUtc,
  }));
}

async function linkOrCopyFile(sourcePath, targetPath) {
  try {
    await fs.link(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM' && error?.code !== 'EEXIST') {
      throw error;
    }
    await fs.copyFile(sourcePath, targetPath);
  }
}

export async function stageWindowSourceRoot({
  files,
  stagingDir,
  manifest = null,
} = {}) {
  const resolvedStagingDir = path.resolve(stagingDir);
  await fs.rm(resolvedStagingDir, { recursive: true, force: true });
  await fs.mkdir(resolvedStagingDir, { recursive: true });

  for (const file of files || []) {
    await linkOrCopyFile(file.filePath, path.join(resolvedStagingDir, file.fileName));
  }

  if (manifest) {
    await fs.writeFile(
      path.join(resolvedStagingDir, 'window-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  }

  return resolvedStagingDir;
}

export function summarizeCatalogRange(catalog) {
  const ordered = [...(catalog || [])].sort((a, b) => a.runUtc.localeCompare(b.runUtc));
  return {
    fileCount: ordered.length,
    firstRunUtc: ordered[0]?.runUtc || null,
    lastRunUtc: ordered.at(-1)?.runUtc || null,
  };
}
