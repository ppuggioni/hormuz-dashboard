import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolvePath(filePath) {
  return filePath instanceof URL ? fileURLToPath(filePath) : filePath;
}

async function readJsonWithBootstrap(filePath, createDefaultValue) {
  const resolvedPath = resolvePath(filePath);
  try {
    return JSON.parse(await fs.readFile(resolvedPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const value = createDefaultValue();
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, JSON.stringify(value, null, 2) + '\n');
    return value;
  }
}

export function createEmptyUsniFleetHistory() {
  return {
    version: 1,
    items: [],
  };
}

export function createEmptyUsniFleetLatestRun(runAt = new Date().toISOString()) {
  return {
    version: 1,
    runAt,
    sourceUrl: 'https://news.usni.org/category/fleet-tracker',
    sourceApiUrl: 'https://news.usni.org/wp-json/wp/v2',
    newItemIds: [],
    downloadedMaps: 0,
    itemCount: 0,
    trackerItemCount: 0,
    newsItemCount: 0,
    latestPublishedAt: null,
  };
}

export function createEmptyUsniFleetMapExtractions() {
  return {
    version: 1,
    generatedAt: null,
    itemCount: 0,
    extractedCount: 0,
    items: {},
  };
}

export async function loadUsniFleetHistory(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyUsniFleetHistory());
}

export async function loadUsniFleetLatestRun(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyUsniFleetLatestRun());
}

export async function loadUsniFleetMapExtractions(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyUsniFleetMapExtractions());
}
