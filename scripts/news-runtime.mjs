import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function createSummary(headline, body, generatedAt) {
  return { headline, body, generatedAt };
}

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

export function createEmptyNewsHistory() {
  return {
    version: 1,
    items: [],
  };
}

export function createEmptyNewsInbox(runAt = new Date().toISOString()) {
  return {
    version: 1,
    runAt,
    lastUpdateSummary: null,
    last24hSummary: null,
    vesselAttacks24hSummary: null,
    vesselAttacksLatest: [],
    previousDaySummary: null,
    items: [],
  };
}

export function createEmptyNewsLatestRun(runAt = new Date().toISOString()) {
  return {
    version: 1,
    runAt,
    lastUpdateSummary: createSummary(
      'No news updates yet',
      'Run the news ingest pipeline to populate the latest summary.',
      runAt,
    ),
    last24hSummary: createSummary(
      'No 24h summary yet',
      'Run the news ingest pipeline to populate the 24-hour summary.',
      runAt,
    ),
    vesselAttacks24hSummary: createSummary(
      'No vessel-attack summary yet',
      'Run the news ingest pipeline to publish the latest vessel-attack summary.',
      runAt,
    ),
    vesselAttacksLatest: [],
    previousDaySummary: null,
    newItems: [],
  };
}

export function createDefaultNewsRuntime(runAt = new Date().toISOString()) {
  return {
    history: createEmptyNewsHistory(),
    latestRun: createEmptyNewsLatestRun(runAt),
    inbox: createEmptyNewsInbox(runAt),
  };
}

export async function loadNewsHistory(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyNewsHistory());
}

export async function loadNewsLatestRun(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyNewsLatestRun());
}

export async function loadNewsInbox(filePath) {
  return readJsonWithBootstrap(filePath, () => createEmptyNewsInbox());
}
