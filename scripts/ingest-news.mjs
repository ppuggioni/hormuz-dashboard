import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const HISTORY_PATH = path.join(ROOT, 'data', 'news-history.json');
const LATEST_RUN_PATH = path.join(ROOT, 'data', 'news-latest-run.json');
const INBOX_PATH = path.join(ROOT, 'data', 'news-inbox.json');

function normalizePublishedAt(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T06:00:00Z`;
  return value;
}

function requireField(obj, field, ctx) {
  if (!obj?.[field]) throw new Error(`Missing required field ${field} in ${ctx}`);
  return obj[field];
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const inbox = JSON.parse(await fs.readFile(INBOX_PATH, 'utf8'));
const previousLatestRun = JSON.parse(await fs.readFile(LATEST_RUN_PATH, 'utf8'));

if (!Array.isArray(inbox.items) || inbox.items.length === 0) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: 'news inbox is empty; preserving previous latest-run metadata',
    totalHistoryItems: (history.items || []).length,
  }, null, 2));
  process.exit(0);
}

const runAt = inbox.runAt || new Date().toISOString();
const existingByUrl = new Map((history.items || []).map((item) => [item.canonicalUrl, item]));
const newIds = [];

for (const item of inbox.items || []) {
  const canonicalUrl = requireField(item, 'canonicalUrl', `news-inbox item ${item.id || '(no id)'}`);
  const existing = existingByUrl.get(canonicalUrl);
  const normalized = {
    id: requireField(item, 'id', `news-inbox item ${canonicalUrl}`),
    canonicalUrl,
    sourceId: requireField(item, 'sourceId', `news-inbox item ${canonicalUrl}`),
    sourceName: requireField(item, 'sourceName', `news-inbox item ${canonicalUrl}`),
    sourceType: requireField(item, 'sourceType', `news-inbox item ${canonicalUrl}`),
    publishedAt: normalizePublishedAt(requireField(item, 'publishedAt', `news-inbox item ${canonicalUrl}`)),
    firstSeenAt: existing?.firstSeenAt || runAt,
    lastSeenAt: runAt,
    title: requireField(item, 'title', `news-inbox item ${canonicalUrl}`),
    summary: requireField(item, 'summary', `news-inbox item ${canonicalUrl}`),
    tags: Array.isArray(item.tags) ? item.tags : [],
    figureNote: item.figureNote || null,
  };

  if (!existing) {
    newIds.push(normalized.id);
  }
  existingByUrl.set(canonicalUrl, { ...existing, ...normalized });
}

const mergedItems = [...existingByUrl.values()].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));

const latestRun = {
  version: 1,
  runAt,
  lastUpdateSummary: inbox.lastUpdateSummary || {
    headline: 'No last-update summary provided',
    body: 'Populate data/news-inbox.json before ingest.',
    generatedAt: runAt,
  },
  last24hSummary: inbox.last24hSummary || {
    headline: 'No 24h summary provided',
    body: 'Populate data/news-inbox.json before ingest.',
    generatedAt: runAt,
  },
  vesselAttacks24hSummary: inbox.vesselAttacks24hSummary || previousLatestRun.vesselAttacks24hSummary || {
    headline: 'No vessel-attack summary provided',
    body: 'Populate data/news-inbox.json with a dedicated last-24h vessel-attacks summary, even if the answer is that there were no credible fresh attacks.',
    generatedAt: runAt,
  },
  previousDaySummary: inbox.previousDaySummary || previousLatestRun.previousDaySummary || null,
  newItems: newIds,
};

await fs.writeFile(HISTORY_PATH, JSON.stringify({ version: 1, items: mergedItems }, null, 2) + '\n');
await fs.writeFile(LATEST_RUN_PATH, JSON.stringify(latestRun, null, 2) + '\n');

console.log(JSON.stringify({
  ok: true,
  runAt,
  inboxItems: (inbox.items || []).length,
  newItems: newIds.length,
  totalHistoryItems: mergedItems.length,
}, null, 2));
