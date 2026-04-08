import fs from 'node:fs/promises';
import path from 'node:path';
import { buildUsniFleetArtifacts } from './usni-fleet-artifacts.mjs';
import { loadUsniFleetHistory, loadUsniFleetLatestRun } from './usni-fleet-runtime.mjs';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'usni-fleet-history.json');
const LATEST_RUN_PATH = path.join(ROOT, 'data', 'usni-fleet-latest-run.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_PATH = path.join(OUT_DIR, 'usni_fleet_tracker.json');

const history = await loadUsniFleetHistory(HISTORY_PATH);
const latestRun = await loadUsniFleetLatestRun(LATEST_RUN_PATH);
const payload = buildUsniFleetArtifacts({ history, latestRun });

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');

console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
