import fs from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_ARCHIVE_FILES = Object.freeze([
  'processed_core.json',
  'processed_paths.json',
  'processed_candidates.json',
]);

export const DEFAULT_FULL_BASELINE_MAX_FILES = Number(
  process.env.HORMUZ_WINDOWED_MAX_BASELINE_FILES || 5000,
);

export const DEFAULT_FULL_BASELINE_MAX_BYTES = Number(
  process.env.HORMUZ_WINDOWED_MAX_BASELINE_BYTES || 1_500_000_000,
);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function summarizeCatalogRecords(catalog = []) {
  const ordered = [...catalog].sort((a, b) => {
    if (a.runUtc !== b.runUtc) return String(a.runUtc).localeCompare(String(b.runUtc));
    if (a.regionId !== b.regionId) return String(a.regionId).localeCompare(String(b.regionId));
    return String(a.fileName).localeCompare(String(b.fileName));
  });

  const regionFileCounts = {};
  const regionBytes = {};
  let totalBytes = 0;

  for (const record of ordered) {
    regionFileCounts[record.regionId] = (regionFileCounts[record.regionId] || 0) + 1;
    regionBytes[record.regionId] = (regionBytes[record.regionId] || 0) + (record.bytes || 0);
    totalBytes += record.bytes || 0;
  }

  return {
    fileCount: ordered.length,
    totalBytes,
    totalBytesHuman: formatBytes(totalBytes),
    firstRunUtc: ordered[0]?.runUtc || null,
    lastRunUtc: ordered.at(-1)?.runUtc || null,
    regionFileCounts,
    regionBytes,
  };
}

export function assessFullBaselineRisk(summary, {
  allowLargeBaseline = process.env.HORMUZ_WINDOWED_ALLOW_LARGE_BASELINE === '1',
  maxFiles = DEFAULT_FULL_BASELINE_MAX_FILES,
  maxBytes = DEFAULT_FULL_BASELINE_MAX_BYTES,
} = {}) {
  const fileCount = Number(summary?.fileCount || 0);
  const totalBytes = Number(summary?.totalBytes || 0);
  const exceedsFileLimit = Number.isFinite(maxFiles) && maxFiles > 0 && fileCount > maxFiles;
  const exceedsByteLimit = Number.isFinite(maxBytes) && maxBytes > 0 && totalBytes > maxBytes;
  const blocked = !allowLargeBaseline && (exceedsFileLimit || exceedsByteLimit);

  const reasons = [];
  if (exceedsFileLimit) reasons.push(`${fileCount} files exceeds limit ${maxFiles}`);
  if (exceedsByteLimit) reasons.push(`${formatBytes(totalBytes)} exceeds limit ${formatBytes(maxBytes)}`);

  return {
    allowLargeBaseline,
    maxFiles,
    maxBytes,
    blocked,
    exceedsFileLimit,
    exceedsByteLimit,
    reasons,
    summary: {
      ...summary,
      totalBytesHuman: formatBytes(totalBytes),
    },
  };
}

export function assertSafeFullBaseline(summary, options = {}) {
  const report = assessFullBaselineRisk(summary, options);
  if (!report.blocked) return report;

  const details = report.reasons.length ? report.reasons.join('; ') : 'catalog exceeds safe baseline limits';
  throw new Error(
    [
      'windowed:baseline refused to run on a large historical archive.',
      details,
      'The current scripts/build-data.mjs path replays the whole archive in memory',
      'by loading full CSV text, holding all observations/snapshots/path arrays, and JSON-stringifying giant outputs.',
      'Use the existing archive plus windowed:refresh/windowed:rerun-all, or rerun with HORMUZ_WINDOWED_ALLOW_LARGE_BASELINE=1 if you really want the risky full replay.',
    ].join(' '),
  );
}

async function hasRequiredArtifacts(dirPath, requiredFiles = REQUIRED_ARCHIVE_FILES) {
  if (!dirPath) return false;
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) return false;
  } catch {
    return false;
  }

  for (const fileName of requiredFiles) {
    try {
      await fs.access(path.join(dirPath, fileName));
    } catch {
      return false;
    }
  }
  return true;
}

export async function resolveUsableArchiveDir(candidateDirs, {
  requiredFiles = REQUIRED_ARCHIVE_FILES,
} = {}) {
  for (const candidate of candidateDirs || []) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (await hasRequiredArtifacts(resolved, requiredFiles)) return resolved;
  }
  return null;
}
