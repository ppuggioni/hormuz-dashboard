import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadUsniFleetHistory, loadUsniFleetMapExtractions } from './usni-fleet-runtime.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'usni-fleet-history.json');
const EXTRACTIONS_PATH = path.join(ROOT, 'data', 'usni-fleet-map-extractions.json');
const OCR_SCRIPT_PATH = path.join(ROOT, 'scripts', 'usni-fleet-map-ocr.swift');

function resolveLocalImagePath(item) {
  if (!item?.mapImageLocalUrl) return null;
  const relativePath = item.mapImageLocalUrl.replace(/^\/data\//, '');
  return path.join(ROOT, 'public', 'data', relativePath);
}

const history = await loadUsniFleetHistory(HISTORY_PATH);
const existing = await loadUsniFleetMapExtractions(EXTRACTIONS_PATH);
const items = Array.isArray(history.items) ? history.items : [];
const nextItems = {};
let extractedCount = 0;

for (const item of items) {
  if (item?.sourceKind !== 'fleet_tracker') continue;
  const localImagePath = resolveLocalImagePath(item);
  if (!localImagePath) continue;
  try {
    await fs.access(localImagePath);
  } catch {
    continue;
  }

  const run = spawnSync('swift', [OCR_SCRIPT_PATH, localImagePath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`swift OCR failed for ${item.slug}: ${run.stderr || run.stdout}`);
  }

  const parsed = JSON.parse(run.stdout || '{}');
  nextItems[item.id] = {
    sourceItemId: item.id,
    slug: item.slug,
    publishedAt: item.publishedAt,
    mapImageLocalUrl: item.mapImageLocalUrl || null,
    mapImageRemoteUrl: item.mapImageRemoteUrl || null,
    extractedAt: new Date().toISOString(),
    width: parsed.width || null,
    height: parsed.height || null,
    lines: Array.isArray(parsed.lines) ? parsed.lines : [],
  };
  extractedCount += 1;
}

const payload = {
  ...existing,
  version: 1,
  generatedAt: new Date().toISOString(),
  itemCount: Object.keys(nextItems).length,
  extractedCount,
  items: nextItems,
};

await fs.mkdir(path.dirname(EXTRACTIONS_PATH), { recursive: true });
await fs.writeFile(EXTRACTIONS_PATH, JSON.stringify(payload, null, 2) + '\n');

console.log(JSON.stringify({
  ok: true,
  extractedCount,
  itemCount: payload.itemCount,
}, null, 2));
