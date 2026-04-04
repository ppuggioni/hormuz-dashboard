import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function readJsonWithBootstrap(filePath, createDefaultValue) {
  const resolvedPath = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
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

export function createEmptyIranUpdateHistory() {
  return {
    version: 1,
    items: [],
  };
}

export function createEmptyIranUpdateLatestRun(runAt = new Date().toISOString()) {
  return {
    version: 1,
    runAt,
    sourceUrl: 'https://understandingwar.org/research/?_product_line_filter=iran-update',
    newItems: [],
    newFigureIds: [],
    itemCount: 0,
    figureCount: 0,
    latestPublishedAt: null,
  };
}

export function createEmptyIranUpdatePublishState(runAt = new Date().toISOString()) {
  return {
    version: 1,
    lastCheckedAt: runAt,
    lastPublishedAt: null,
    lastPublishedReportId: null,
    lastPublishedReportDate: null,
  };
}

export async function loadIranUpdateHistory(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyIranUpdateHistory());
}

export async function loadIranUpdateLatestRun(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyIranUpdateLatestRun());
}

export async function loadIranUpdatePublishState(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyIranUpdatePublishState());
}
