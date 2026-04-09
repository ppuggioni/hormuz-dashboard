import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.resolve(ROOT, '../.env');
const ARTIFACT_PATH = path.join(ROOT, 'public', 'data', 'usni_fleet_tracker.json');
const STATE_PATH = path.join(ROOT, 'data', 'usni-fleet-telegram-state.json');

try {
  const rawEnv = await fs.readFile(ENV_PATH, 'utf8');
  for (const line of rawEnv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALERTS_PUBLIC_BASE_URL = process.env.ALERTS_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://hormuz-dashboard-six.vercel.app/';

const DIRECTION_ORDER = [
  'entered_combat_zone',
  'toward_arabian_sea',
  'exited_combat_zone',
  'away_from_arabian_sea',
  'repositioned',
  'unchanged',
];

function must(value, name) {
  if (!value) throw new Error(`${name} missing`);
  return value;
}

async function tg(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${must(TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(payload)}`);
  return payload.result;
}

async function supa(restPath, init = {}) {
  const response = await fetch(`${must(SUPABASE_URL, 'SUPABASE_URL')}/rest/v1/${restPath}`, {
    ...init,
    headers: {
      apikey: must(SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${must(SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${restPath} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readJsonWithBootstrap(filePath, createDefaultValue) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const value = createDefaultValue();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    return value;
  }
}

function createEmptyUsniTelegramState(runAt = new Date().toISOString()) {
  return {
    version: 1,
    initializedAt: null,
    lastEvaluatedAt: runAt,
    lastPublishedAt: null,
    seenMovementKeys: [],
  };
}

async function loadUsniTelegramState() {
  return readJsonWithBootstrap(STATE_PATH, () => createEmptyUsniTelegramState());
}

async function saveUsniTelegramState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function movementEventKey(row) {
  return [
    'usni',
    row.vesselKey || row.vesselName || 'unknown',
    row.date || 'unknown',
    row.direction || 'unknown',
    row.previousPosition || 'unknown',
    row.currentPosition || 'unknown',
  ].join('|');
}

function formatDate(date) {
  if (!date) return 'Unknown date';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(date);
  return parsed.toISOString().slice(0, 10);
}

function formatUtc(date) {
  if (!date) return 'Unknown';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return String(date);
  return parsed.toUTCString();
}

function directionLabel(direction) {
  switch (direction) {
    case 'entered_combat_zone':
      return 'entered combat zone';
    case 'toward_arabian_sea':
      return 'toward Arabian Sea';
    case 'exited_combat_zone':
      return 'exited combat zone';
    case 'away_from_arabian_sea':
      return 'away from Arabian Sea';
    case 'unchanged':
      return 'unchanged';
    default:
      return 'repositioned';
  }
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const priorityDelta = DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction);
    if (priorityDelta !== 0) return priorityDelta;
    const dateDelta = +new Date(`${b.date || '1970-01-01'}T00:00:00Z`) - +new Date(`${a.date || '1970-01-01'}T00:00:00Z`);
    if (dateDelta !== 0) return dateDelta;
    return String(a.vesselName || '').localeCompare(String(b.vesselName || ''));
  });
}

function buildMovementSummary(rows, metadata) {
  const sortedRows = sortRows(rows);
  const groups = new Map();
  for (const direction of DIRECTION_ORDER) groups.set(direction, []);
  for (const row of sortedRows) groups.get(row.direction)?.push(row);

  const towardCount = (groups.get('entered_combat_zone')?.length || 0) + (groups.get('toward_arabian_sea')?.length || 0);
  const awayCount = (groups.get('exited_combat_zone')?.length || 0) + (groups.get('away_from_arabian_sea')?.length || 0);
  const otherCount = (groups.get('repositioned')?.length || 0) + (groups.get('unchanged')?.length || 0);

  const sections = [];
  for (const direction of DIRECTION_ORDER) {
    const items = groups.get(direction) || [];
    if (!items.length) continue;
    const header = `${directionLabel(direction)} (${items.length})`;
    const lines = items.slice(0, 3).map((row) => (
      `- ${row.vesselName} (${row.vesselType}): ${row.previousPosition} -> ${row.currentPosition} (${formatDate(row.date)})`
    ));
    if (items.length > lines.length) lines.push(`- +${items.length - lines.length} more`);
    sections.push([header, ...lines].join('\n'));
  }

  return [
    'US Navy movement update',
    '',
    `Detected ${rows.length} new movement change${rows.length === 1 ? '' : 's'} from the latest USNI fleet refresh.`,
    `Toward / entered: ${towardCount} | Away / exited: ${awayCount} | Other: ${otherCount}`,
    metadata?.latestPublishedAt ? `Latest source timestamp: ${formatUtc(metadata.latestPublishedAt)}` : '',
    '',
    ...sections,
    '',
    `Dashboard: ${ALERTS_PUBLIC_BASE_URL}#usni-fleet`,
  ].filter(Boolean).join('\n');
}

async function dispatchUsniFleetAlerts() {
  const artifact = JSON.parse(await fs.readFile(ARTIFACT_PATH, 'utf8'));
  const movementRows = Array.isArray(artifact?.movementRows) ? artifact.movementRows : [];
  const state = await loadUsniTelegramState();
  const currentKeys = movementRows.map(movementEventKey);
  const seenKeys = new Set(Array.isArray(state.seenMovementKeys) ? state.seenMovementKeys : []);
  const runAt = artifact?.metadata?.lastRunAt || new Date().toISOString();

  if (!state.initializedAt) {
    state.initializedAt = runAt;
    state.lastEvaluatedAt = runAt;
    state.lastPublishedAt = artifact?.metadata?.latestPublishedAt || null;
    state.seenMovementKeys = currentKeys;
    await saveUsniTelegramState(state);
    console.log(`[tg-usni] seeded baseline movements=${currentKeys.length}`);
    return;
  }

  const freshRows = movementRows.filter((row) => !seenKeys.has(movementEventKey(row)));
  if (!freshRows.length) {
    state.lastEvaluatedAt = runAt;
    state.lastPublishedAt = artifact?.metadata?.latestPublishedAt || state.lastPublishedAt || null;
    state.seenMovementKeys = currentKeys;
    await saveUsniTelegramState(state);
    console.log('[tg-usni] no new movement rows');
    return;
  }

  const subs = await supa('marinetraffic_telegram_subscribers?is_active=eq.true&select=id,chat_id');
  if (!subs?.length) {
    state.lastEvaluatedAt = runAt;
    state.lastPublishedAt = artifact?.metadata?.latestPublishedAt || state.lastPublishedAt || null;
    state.seenMovementKeys = currentKeys;
    await saveUsniTelegramState(state);
    console.log('[tg-usni] no active subscribers; advancing baseline');
    return;
  }

  let sentMessages = 0;
  let sentRows = 0;
  const freshKeys = freshRows.map(movementEventKey);

  for (const sub of subs) {
    const keyFilter = `(${freshKeys.map((key) => `"${key.replaceAll('"', '')}"`).join(',')})`;
    const existing = await supa(`marinetraffic_telegram_events_sent?subscriber_id=eq.${sub.id}&event_key=in.${encodeURIComponent(keyFilter)}&select=event_key`);
    const existingSet = new Set((existing || []).map((row) => row.event_key));
    const unsentRows = freshRows.filter((row) => !existingSet.has(movementEventKey(row)));
    if (!unsentRows.length) continue;

    const message = buildMovementSummary(unsentRows, artifact?.metadata || null);
    await tg('sendMessage', { chat_id: sub.chat_id, text: message, disable_web_page_preview: true });
    sentMessages += 1;

    const rowsToInsert = unsentRows.map((row) => ({
      subscriber_id: sub.id,
      event_key: movementEventKey(row),
    }));
    await supa('marinetraffic_telegram_events_sent?on_conflict=subscriber_id,event_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rowsToInsert),
    });
    sentRows += rowsToInsert.length;

    await supa(`marinetraffic_telegram_subscribers?id=eq.${sub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
    });
  }

  state.lastEvaluatedAt = runAt;
  state.lastPublishedAt = artifact?.metadata?.latestPublishedAt || state.lastPublishedAt || null;
  state.seenMovementKeys = currentKeys;
  await saveUsniTelegramState(state);
  console.log(`[tg-usni] sent_msgs=${sentMessages} sent_rows=${sentRows}`);
}

async function run() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[tg-usni] skip: TELEGRAM_BOT_TOKEN not set');
    return;
  }
  await dispatchUsniFleetAlerts();
}

run().catch((error) => {
  console.error('[tg-usni] error', error?.message || error);
  process.exit(1);
});
