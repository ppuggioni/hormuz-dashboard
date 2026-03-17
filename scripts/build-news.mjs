import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const WATCHLIST_PATH = path.join(ROOT, 'config', 'news-watchlist.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'news-history.json');
const LATEST_RUN_PATH = path.join(ROOT, 'data', 'news-latest-run.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const FEED_PATH = path.join(OUT_DIR, 'news_feed.json');
const ATTACKS_PATH = path.join(OUT_DIR, 'vessel_attacks_latest.json');

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function normalizePublishedAt(iso) {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso}T06:00:00Z`;
  return iso;
}

const watchlist = JSON.parse(await fs.readFile(WATCHLIST_PATH, 'utf8'));
const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const latestRun = JSON.parse(await fs.readFile(LATEST_RUN_PATH, 'utf8'));

const sourceMap = new Map((watchlist.sources || []).map((s) => [s.id, s]));
const newItemIds = new Set(latestRun.newItems || []);

const deduped = new Map();
for (const item of history.items || []) {
  const canonicalUrl = item.canonicalUrl || item.url || item.id;
  const normalized = {
    id: item.id,
    canonicalUrl,
    url: canonicalUrl,
    title: item.title || sourceMap.get(item.sourceId)?.name || 'Untitled',
    sourceId: item.sourceId,
    sourceName: item.sourceName || sourceMap.get(item.sourceId)?.name || 'Unknown source',
    sourceType: item.sourceType || sourceMap.get(item.sourceId)?.type || 'unknown',
    publishedAt: normalizePublishedAt(item.publishedAt) || item.firstSeenAt || latestRun.runAt,
    firstSeenAt: item.firstSeenAt || latestRun.runAt,
    lastSeenAt: item.lastSeenAt || latestRun.runAt,
    summary: item.summary || '',
    tags: uniq([...(sourceMap.get(item.sourceId)?.tags || []), ...(item.tags || [])]).slice(0, 8),
    figureNote: item.figureNote || null,
    isNew: newItemIds.has(item.id),
    lastRunAt: latestRun.runAt,
  };
  deduped.set(canonicalUrl, normalized);
}

const items = [...deduped.values()].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
const vesselAttacksLatest = Array.isArray(latestRun.vesselAttacksLatest)
  ? latestRun.vesselAttacksLatest.map((item) => ({
      date: item?.date || null,
      place: item?.place || null,
      summary: item?.summary || null,
    })).filter((item) => item.date || item.place || item.summary)
  : [];

const payload = {
  metadata: {
    generatedAt: new Date().toISOString(),
    profile: watchlist.profile || 'hormuz-news',
    sourceCount: (watchlist.sources || []).length,
    itemCount: items.length,
    lastRunAt: latestRun.runAt,
    newItemCount: items.filter((item) => item.isNew).length,
  },
  lastUpdateSummary: latestRun.lastUpdateSummary,
  last24hSummary: latestRun.last24hSummary,
  vesselAttacks24hSummary: latestRun.vesselAttacks24hSummary || null,
  vesselAttacksLatest,
  previousDaySummary: latestRun.previousDaySummary || null,
  sources: (watchlist.sources || []).map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    priority: source.priority || 0,
    tags: source.tags || [],
    collectionRule: source.collectionRule || null,
  })),
  items,
};

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(FEED_PATH, JSON.stringify(payload, null, 2) + '\n');
await fs.writeFile(ATTACKS_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  lastRunAt: latestRun.runAt,
  vesselAttacks24hSummary: latestRun.vesselAttacks24hSummary || null,
  items: vesselAttacksLatest,
}, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, FEED_PATH)}`);
console.log(`Wrote ${path.relative(ROOT, ATTACKS_PATH)}`);
