import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIranUpdateArtifacts, loadIranUpdateExtractionRecords } from './iran-update-artifacts.mjs';
import { loadIranUpdateHistory, loadIranUpdateLatestRun } from './iran-update-runtime.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'iran-update-history.json');
const LATEST_RUN_PATH = path.join(ROOT, 'data', 'iran-update-latest-run.json');
const EXTRACTIONS_DIR = path.join(ROOT, 'data', 'iran-update-figure-extractions');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const UPDATES_PATH = path.join(OUT_DIR, 'iran_updates.json');
const FIGURES_PATH = path.join(OUT_DIR, 'iran_update_figures.json');

const history = await loadIranUpdateHistory(HISTORY_PATH);
const latestRun = await loadIranUpdateLatestRun(LATEST_RUN_PATH);
const extractionRecords = await loadIranUpdateExtractionRecords(EXTRACTIONS_DIR);
const { updatesPayload, figuresPayload } = buildIranUpdateArtifacts({ history, latestRun, extractionRecords });

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(UPDATES_PATH, JSON.stringify(updatesPayload, null, 2) + '\n');
await fs.writeFile(FIGURES_PATH, JSON.stringify(figuresPayload, null, 2) + '\n');

console.log(`Wrote ${path.relative(ROOT, UPDATES_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, FIGURES_PATH)}`);
